// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "OliNative",
    platforms: [.macOS(.v15)],
    products: [
        .executable(name: "OliNotchGeometry", targets: ["OliNotchGeometry"]),
        .executable(name: "OliCaptureService", targets: ["OliCaptureService"]),
        .executable(name: "OliHUD", targets: ["OliHUD"])
    ],
    targets: [
        .executableTarget(name: "OliNotchGeometry"),
        .executableTarget(name: "OliCaptureService"),
        .executableTarget(name: "OliHUD")
    ]
)
