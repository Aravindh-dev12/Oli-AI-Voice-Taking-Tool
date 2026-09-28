// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "OliNative",
    platforms: [.macOS(.v15)],
    products: [
        .executable(name: "OliNotchGeometry", targets: ["OliNotchGeometry"]),
        .executable(name: "OliCaptureService", targets: ["OliCaptureService"])
    ],
    targets: [
        .executableTarget(name: "OliNotchGeometry"),
        .executableTarget(name: "OliCaptureService")
    ]
)
