import AVFoundation
import CoreGraphics
import CoreMedia
import Foundation
import ScreenCaptureKit

private let targetSampleRate = 16_000
private let targetChannels = 1
private let chunkFrames = 96_000

struct Event: Codable {
    let type: String
    let source: String?
    let seq: Int?
    let wav: String?
    let sampleRate: Int?
    let channels: Int?
    let message: String?
}

final class Output {
    private let lock = NSLock()

    func send(_ event: Event) {
        do {
            let data = try JSONEncoder().encode(event)
            lock.lock()
            FileHandle.standardOutput.write(data)
            FileHandle.standardOutput.write(Data([10]))
            lock.unlock()
        } catch {
            // stdout is the IPC channel; if it fails, there is no useful recovery here.
        }
    }
}

final class PCMChunker {
    private var samples: [Float] = []
    private var sequence = 0
    private let source: String
    private let output: Output

    init(source: String, output: Output) {
        self.source = source
        self.output = output
        samples.reserveCapacity(chunkFrames)
    }

    func append(_ values: [Float]) {
        samples.append(contentsOf: values)
        while samples.count >= chunkFrames {
            let chunk = Array(samples.prefix(chunkFrames))
            samples.removeFirst(chunkFrames)
            emit(chunk)
        }
    }

    func flush() {
        guard !samples.isEmpty else { return }
        emit(samples)
        samples.removeAll(keepingCapacity: true)
    }

    private func emit(_ pcm: [Float]) {
        let wav = makeWav(pcm: pcm)
        let event = Event(
            type: "audio",
            source: source,
            seq: sequence,
            wav: wav.base64EncodedString(),
            sampleRate: targetSampleRate,
            channels: targetChannels,
            message: nil
        )
        sequence += 1
        output.send(event)
    }

    private func makeWav(pcm: [Float]) -> Data {
        var data = Data()
        let byteRate = targetSampleRate * targetChannels * 2
        let blockAlign = UInt16(targetChannels * 2)
        let pcmByteCount = UInt32(pcm.count * 2)
        let riffSize = UInt32(36) + pcmByteCount

        appendString("RIFF", to: &data)
        appendUInt32LE(riffSize, to: &data)
        appendString("WAVE", to: &data)
        appendString("fmt ", to: &data)
        appendUInt32LE(16, to: &data)
        appendUInt16LE(1, to: &data)
        appendUInt16LE(UInt16(targetChannels), to: &data)
        appendUInt32LE(UInt32(targetSampleRate), to: &data)
        appendUInt32LE(UInt32(byteRate), to: &data)
        appendUInt16LE(blockAlign, to: &data)
        appendUInt16LE(16, to: &data)
        appendString("data", to: &data)
        appendUInt32LE(pcmByteCount, to: &data)

        for value in pcm {
            let clamped = max(-1.0, min(1.0, value))
            let signed = Int16((clamped * Float(Int16.max)).rounded())
            appendInt16LE(signed, to: &data)
        }
        return data
    }
}

func appendString(_ value: String, to data: inout Data) {
    data.append(contentsOf: value.utf8)
}
func appendUInt16LE(_ value: UInt16, to data: inout Data) {
    data.append(UInt8(value & 0xff))
    data.append(UInt8((value >> 8) & 0xff))
}
func appendUInt32LE(_ value: UInt32, to data: inout Data) {
    data.append(UInt8(value & 0xff))
    data.append(UInt8((value >> 8) & 0xff))
    data.append(UInt8((value >> 16) & 0xff))
    data.append(UInt8((value >> 24) & 0xff))
}
func appendInt16LE(_ value: Int16, to data: inout Data) {
    appendUInt16LE(UInt16(bitPattern: value), to: &data)
}

final class CaptureService: NSObject, SCStreamOutput, SCStreamDelegate {
    private let output = Output()
    private let systemQueue = DispatchQueue(label: "dev.oli.capture.system", qos: .userInitiated)
    private let microphoneQueue = DispatchQueue(label: "dev.oli.capture.microphone", qos: .userInitiated)
    private lazy var systemChunker = PCMChunker(source: "them", output: output)
    private lazy var microphoneChunker = PCMChunker(source: "me", output: output)
    private var stream: SCStream?

    func start() async throws {
        try await requestPermissions()

        let shareable = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = selectDisplay(from: shareable.displays) else {
            throw NSError(domain: "OliCapture", code: 1, userInfo: [NSLocalizedDescriptionKey: "No display is available for system audio capture."])
        }

        let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])

        let configuration = SCStreamConfiguration()
        configuration.capturesAudio = true
        if #available(macOS 15.0, *) {
            configuration.captureMicrophone = true
        }
        configuration.excludesCurrentProcessAudio = true
        configuration.sampleRate = targetSampleRate
        configuration.channelCount = targetChannels
        configuration.queueDepth = 3
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 10)

        let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
        self.stream = stream

        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: systemQueue)
        if #available(macOS 15.0, *) {
            try stream.addStreamOutput(self, type: .microphone, sampleHandlerQueue: microphoneQueue)
        }

        try await stream.startCapture()

        output.send(Event(
            type: "ready",
            source: nil,
            seq: nil,
            wav: nil,
            sampleRate: targetSampleRate,
            channels: targetChannels,
            message: "ScreenCaptureKit native dual-channel capture active."
        ))
    }

    func stop() async {
        systemChunker.flush()
        microphoneChunker.flush()
        do {
            try await stream?.stopCapture()
        } catch {
            output.send(Event(
                type: "error",
                source: nil,
                seq: nil,
                wav: nil,
                sampleRate: nil,
                channels: nil,
                message: "Capture stop failed: " + error.localizedDescription
            ))
        }
        stream = nil
        output.send(Event(type: "stopped", source: nil, seq: nil, wav: nil, sampleRate: nil, channels: nil, message: nil))
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of outputType: SCStreamOutputType) {
        guard sampleBuffer.isValid else { return }
        guard let samples = extractMonoFloatSamples(sampleBuffer) else { return }

        switch outputType {
        case .audio:
            systemChunker.append(samples)
        case .microphone:
            microphoneChunker.append(samples)
        default:
            break
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        output.send(Event(type: "error", source: nil, seq: nil, wav: nil, sampleRate: nil, channels: nil, message: "Capture stream stopped: " + error.localizedDescription))
    }

    private func requestPermissions() async throws {
        if !CGPreflightScreenCaptureAccess() {
            _ = CGRequestScreenCaptureAccess()
        }
        guard CGPreflightScreenCaptureAccess() else {
            throw NSError(domain: "OliCapture", code: 2, userInfo: [NSLocalizedDescriptionKey: "Screen Recording permission is required for native system-audio capture."])
        }

        let micStatus = AVCaptureDevice.authorizationStatus(for: .audio)
        if micStatus == .notDetermined {
            let granted = await AVCaptureDevice.requestAccess(for: .audio)
            if !granted {
                throw NSError(domain: "OliCapture", code: 3, userInfo: [NSLocalizedDescriptionKey: "Microphone permission was denied."])
            }
        }
        guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else {
            throw NSError(domain: "OliCapture", code: 4, userInfo: [NSLocalizedDescriptionKey: "Microphone permission is required for native capture."])
        }
    }

    private func selectDisplay(from displays: [SCDisplay]) -> SCDisplay? {
        let mainDisplayID = (NSScreen.main?.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID)
        if let mainDisplayID, let matching = displays.first(where: { $0.displayID == mainDisplayID }) {
            return matching
        }
        return displays.first
    }

    private func extractMonoFloatSamples(_ sampleBuffer: CMSampleBuffer) -> [Float]? {
        guard let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer),
              let asbdPointer = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription) else {
            return nil
        }
        let asbd = asbdPointer.pointee

        guard Int(asbd.mSampleRate.rounded()) == targetSampleRate else { return nil }
        guard asbd.mChannelsPerFrame == targetChannels else { return nil }

        var bufferList = AudioBufferList(
            mNumberBuffers: 1,
            mBuffers: AudioBuffer(
                mNumberChannels: UInt32(targetChannels),
                mDataByteSize: 0,
                mData: nil
            )
        )
        var retainedBlockBuffer: CMBlockBuffer?

        let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: nil,
            bufferListOut: &bufferList,
            bufferListSize: MemoryLayout<AudioBufferList>.size,
            blockBufferAllocator: nil,
            blockBufferMemoryAllocator: nil,
            flags: UInt32(kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment),
            retainedBlockBufferOut: &retainedBlockBuffer
        )
        guard status == noErr else { return nil }

        let buffer = bufferList.mBuffers
        guard let base = buffer.mData else { return nil }
        let byteCount = Int(buffer.mDataByteSize)
        let bytesPerSample = Int(asbd.mBytesPerFrame)
        guard bytesPerSample > 0 else { return nil }
        let frameCount = byteCount / bytesPerSample
        let formatFlags = asbd.mFormatFlags

        let isFloat = (formatFlags & kAudioFormatFlagIsFloat) != 0
        let isSignedInteger = (formatFlags & kAudioFormatFlagIsSignedInteger) != 0
        let bits = Int(asbd.mBitsPerChannel)

        if isFloat && bits == 32 {
            let typed = base.assumingMemoryBound(to: Float32.self)
            return Array(UnsafeBufferPointer(start: typed, count: frameCount))
        }

        if isSignedInteger && bits == 16 {
            let typed = base.assumingMemoryBound(to: Int16.self)
            return Array(UnsafeBufferPointer(start: typed, count: frameCount)).map { Float($0) / Float(Int16.max) }
        }

        if isSignedInteger && bits == 32 {
            let typed = base.assumingMemoryBound(to: Int32.self)
            return Array(UnsafeBufferPointer(start: typed, count: frameCount)).map { Float($0) / Float(Int32.max) }
        }

        return nil
    }
}

let service = CaptureService()
let group = DispatchGroup()
group.enter()

Task {
    do {
        try await service.start()
    } catch {
        Output().send(Event(type: "error", source: nil, seq: nil, wav: nil, sampleRate: nil, channels: nil, message: error.localizedDescription))
        exit(1)
    }
    group.leave()
}

DispatchQueue.global(qos: .utility).async {
    while let line = readLine() {
        if line.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "stop" {
            Task {
                await service.stop()
                exit(0)
            }
            break
        }
    }
}

dispatchMain()
