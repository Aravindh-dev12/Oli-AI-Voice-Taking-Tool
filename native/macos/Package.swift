// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "OliNative",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "OliNotchGeometry", targets: ["OliNotchGeometry"])
    ],
    targets: [
        .executableTarget(name: "OliNotchGeometry")
    ]
)
