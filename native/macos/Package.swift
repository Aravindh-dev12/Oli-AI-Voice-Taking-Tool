// swift-tools-version: 5.9
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
