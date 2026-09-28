import AppKit
import SwiftUI
import Foundation

private enum HUDState: String, Codable, Sendable {
    case ambient
    case flare
    case shelf
}

@MainActor
final class HUDModel: ObservableObject, @unchecked Sendable {
    @Published var state: HUDState = .ambient
    @Published var talkRatio: Double = 0.45
    @Published var commitments: Int = 0
    @Published var meetingActive = false
    @Published var pinned = false
    @Published var whisper = ""
    @Published var whisperSource = ""
    @Published var transcript: [(speaker: String, text: String)] = []
    @Published var footer = "Ready"
    var onStateChange: ((HUDState) -> Void)?
    var onEvent: (([String: String]) -> Void)?
    private var flareTask: Task<Void, Never>?

    func apply(_ object: [String: Any]) {
        if let type = object["type"] as? String, type == "action" {
            commitments += 1
            if let text = object["task"] as? String { footer = "Commitment noted: " + text }
        }
        if let state = object["state"] as? String, let next = HUDState(rawValue: state) { setState(next) }
        if let ratio = object["talkRatio"] as? Double { talkRatio = max(0, min(1, ratio)) }
        if let count = object["commitments"] as? Int { commitments = max(0, count) }
        if let active = object["active"] as? Bool { meetingActive = active }
        if let speaker = object["speaker"] as? String, let text = object["text"] as? String {
            transcript.append((speaker: speaker, text: text))
            if transcript.count > 8 { transcript.removeFirst(transcript.count - 8) }
        }
        if let whisper = object["whisper"] as? String {
            self.whisper = whisper
            self.whisperSource = object["source"] as? String ?? ""
            setState(.flare)
            flareTask?.cancel()
            flareTask = Task {
                try? await Task.sleep(for: .seconds(5))
                if !Task.isCancelled { await MainActor.run { self.setState(.ambient) } }
            }
        }
        if let footer = object["footer"] as? String { self.footer = footer }
    }

    func toggleShelf() {
        pinned.toggle()
        setState(state == .shelf ? .ambient : .shelf)
    }

    func setState(_ next: HUDState) {
        state = next
        onStateChange?(next)
    }

    func action(_ event: String) {
        onEvent?(["event": event])
    }
}

struct HUDView: View {
    @ObservedObject var model: HUDModel

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: model.state == .shelf ? 22 : 18, style: .continuous)
                .fill(Color.black)
                .overlay(RoundedRectangle(cornerRadius: model.state == .shelf ? 22 : 18, style: .continuous).stroke(Color.white.opacity(0.10), lineWidth: 1))

            switch model.state {
            case .ambient:
                ambient.onTapGesture { model.action(model.meetingActive ? "toggleMeeting" : "startMeeting") }
            case .flare:
                flare
            case .shelf:
                shelf
            }
        }
        .frame(width: width, height: height)
        .animation(.spring(response: 0.30, dampingFraction: 0.82), value: model.state)
        .onHover { hovering in
            if hovering && model.state == .ambient { model.setState(.shelf) }
            if !hovering && model.state == .shelf && !model.pinned { model.setState(.ambient) }
        }

    }

    private var width: CGFloat { model.state == .ambient ? 236 : model.state == .flare ? 480 : 620 }
    private var height: CGFloat { model.state == .ambient ? 36 : model.state == .flare ? 48 : 360 }

    private var ambient: some View {
        HStack(spacing: 10) {
            Circle().fill(model.meetingActive ? Color.green : Color.white.opacity(0.35)).frame(width: 7, height: 7)
            Text(model.meetingActive ? "\(Int(model.talkRatio * 100))% TALK" : "OLI")
                .font(.system(size: 11, weight: .bold, design: .monospaced))
                .foregroundStyle(.white.opacity(0.9))
            if model.meetingActive {
                Capsule().fill(Color.white.opacity(0.14)).frame(width: 54, height: 4).overlay(alignment: .leading) {
                    Capsule().fill(model.talkRatio > 0.65 ? Color.orange : Color.green).frame(width: 54 * model.talkRatio, height: 4)
                }
                Text("⧗ \(model.commitments)").font(.system(size: 10, weight: .semibold, design: .monospaced)).foregroundStyle(.white.opacity(0.65))
            }
        }
        .padding(.horizontal, 16)
    }

    private var flare: some View {
        HStack(spacing: 8) {
            Text("⚡").foregroundStyle(.yellow)
            Text(model.whisper).font(.system(size: 12, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
        }.padding(.horizontal, 16)
    }

    private var shelf: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("OLI COGNITIVE HUD").font(.system(size: 10, weight: .black, design: .monospaced)).foregroundStyle(.white.opacity(0.45))
                    Text(model.meetingActive ? "Live meeting" : "Ready").font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
                }
                Spacer()
                Button(model.meetingActive ? "End" : "Start") { model.action("toggleMeeting") }
                    .buttonStyle(.borderedProminent).tint(.white).foregroundStyle(.black)
                Button("Dashboard") { model.action("dashboard") }.buttonStyle(.bordered)
            }
            Divider().overlay(Color.white.opacity(0.14))
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("LIVE TRANSCRIPT").font(.system(size: 9, weight: .bold, design: .monospaced)).foregroundStyle(.white.opacity(0.4))
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 5) {
                            ForEach(Array(model.transcript.enumerated()), id: \\.offset) { _, item in
                                HStack(alignment: .top, spacing: 6) {
                                    Text(item.speaker.uppercased()).font(.system(size: 8, weight: .bold, design: .monospaced)).foregroundStyle(.white.opacity(0.4)).frame(width: 42, alignment: .leading)
                                    Text(item.text).font(.system(size: 11)).foregroundStyle(.white.opacity(0.85)).lineLimit(3)
                                }
                            }
                        }
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)

                VStack(alignment: .leading, spacing: 8) {
                    Text("IN-FLIGHT INTELLIGENCE").font(.system(size: 9, weight: .bold, design: .monospaced)).foregroundStyle(.white.opacity(0.4))
                    if !model.whisper.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(model.whisper).font(.system(size: 12, weight: .semibold)).foregroundStyle(.yellow)
                            if !model.whisperSource.isEmpty { Text("From \(model.whisperSource)").font(.system(size: 9)).foregroundStyle(.white.opacity(0.35)) }
                        }
                    } else { Text("Listening for triggers…").font(.system(size: 11)).foregroundStyle(.white.opacity(0.45)) }
                    Text("Talk time  \(Int(model.talkRatio * 100))% you").font(.system(size: 10, weight: .medium, design: .monospaced)).foregroundStyle(.white.opacity(0.65))
                    Capsule().fill(Color.white.opacity(0.12)).frame(height: 5).overlay(alignment: .leading) { Capsule().fill(Color.green).frame(width: 220 * model.talkRatio, height: 5) }
                }.frame(width: 230, alignment: .leading)
            }
            Divider().overlay(Color.white.opacity(0.10))
            HStack(spacing: 10) { Text("⧗").foregroundStyle(.yellow); Text(model.commitments == 0 ? model.footer : "\(model.commitments) open commitment(s)").font(.system(size: 10)).foregroundStyle(.white.opacity(0.72)); Spacer() }
        }.padding(16)
    }
}

@MainActor
final class HUDPanel: NSPanel, @unchecked Sendable {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }

    init(size: CGSize, origin: NSPoint) {
        super.init(contentRect: NSRect(origin: origin, size: size), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        level = .statusBar
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        sharingType = .none
        isMovable = false
        isMovableByWindowBackground = false
        ignoresMouseEvents = false
        hidesOnDeactivate = false
        becomesKeyOnlyIfNeeded = false
    }
}

@main
@MainActor
struct OliHUDMain {
    static func main() {
        let application = NSApplication.shared
        application.setActivationPolicy(.accessory)
        let model = HUDModel()

        let controller = HUDController(model: model)
        application.delegate = controller
        application.run()
    }
}

@MainActor
final class HUDController: NSObject, NSApplicationDelegate, @unchecked Sendable {
    let model: HUDModel
    var panel: HUDPanel!
    var stdinTask: Task<Void, Never>?

    init(model: HUDModel) { self.model = model }

    func applicationDidFinishLaunching(_ notification: Notification) {
        positionPanel()
        model.onStateChange = { [weak self] _ in self?.positionPanel() }
        model.onEvent = { [weak self] event in self?.send(event) }
        panel.contentView = NSHostingView(rootView: HUDView(model: model))
        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.positionPanel() }
        }
        panel.orderFrontRegardless()

        stdinTask = Task.detached(priority: .userInitiated) { [weak self] in
            while let line = readLine() {
                await MainActor.run { self?.handle(line: line) }
            }
        }
    }

    func positionPanel() {
        let screen = NSScreen.main ?? NSScreen.screens.first
        guard let screen else { return }
        let width: CGFloat = model.state == .ambient ? 236 : model.state == .flare ? 480 : 620
        let height: CGFloat = model.state == .ambient ? 36 : model.state == .flare ? 48 : 360
        let x = screen.frame.midX - width / 2
        let y = screen.frame.maxY - height
        panel?.setFrame(NSRect(x: x, y: y, width: width, height: height), display: true, animate: true)
    }

    func handle(line: String) {
        guard let data = line.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        if object["type"] as? String == "command", let command = object["command"] as? String {
            switch command {
            case "toggleShelf": model.toggleShelf()
            case "startMeeting": model.action("startMeeting")
            case "endMeeting": model.action("endMeeting")
            case "toggleMeeting": model.action("toggleMeeting")
            case "dashboard": model.action("dashboard")
            case "quit": NSApp.terminate(nil)
            default: break
            }
        } else { model.apply(object) }
    }

    func send(_ payload: [String: String]) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload), let line = String(data: data, encoding: .utf8) else { return }
        FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
    }
}