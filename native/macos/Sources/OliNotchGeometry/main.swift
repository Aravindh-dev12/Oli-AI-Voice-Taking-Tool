import AppKit
import Foundation

struct Geometry: Codable {
    let hasNotch: Bool
    let frameWidth: Double
    let frameHeight: Double
    let topLeftSafeWidth: Double?
    let topRightSafeWidth: Double?
    let notchWidth: Double?
}

let screen = NSScreen.main ?? NSScreen.screens.first
guard let screen else {
    fputs("{\"hasNotch\":false}\n", stderr)
    exit(1)
}

let frame = screen.frame
let left = screen.auxiliaryTopLeftArea
let right = screen.auxiliaryTopRightArea
let notchWidth: Double?
if let left, let right {
    let gap = right.minX - left.maxX
    notchWidth = gap > 0 ? Double(gap) : nil
} else {
    notchWidth = nil
}

let output = Geometry(
    hasNotch: left != nil && right != nil && notchWidth != nil,
    frameWidth: Double(frame.width),
    frameHeight: Double(frame.height),
    topLeftSafeWidth: left.map { Double($0.width) },
    topRightSafeWidth: right.map { Double($0.width) },
    notchWidth: notchWidth
)

let encoder = JSONEncoder()
encoder.outputFormatting = [.sortedKeys]
FileHandle.standardOutput.write(try encoder.encode(output))
FileHandle.standardOutput.write(Data([10]))
