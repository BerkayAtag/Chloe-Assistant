// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ChloeDesktop",
    platforms: [.macOS(.v15)],
    products: [
        .executable(name: "ChloeDesktop", targets: ["ChloeDesktop"]),
    ],
    targets: [
        .executableTarget(name: "ChloeDesktop"),
    ]
)
