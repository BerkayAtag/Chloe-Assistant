import Foundation

// Only explicitly named, verified Chloe bundles may be moved to Trash.
// Never touch the key vault, data directory, or an unrelated application.
let manager = FileManager.default
let targets = CommandLine.arguments.dropFirst().map { URL(fileURLWithPath: $0).standardizedFileURL }
for target in targets {
    let values = try target.resourceValues(forKeys: [.isSymbolicLinkKey, .isDirectoryKey])
    guard target.pathExtension == "app", values.isDirectory == true, values.isSymbolicLink != true,
          let data = try? Data(contentsOf: target.appendingPathComponent("Contents/Info.plist")),
          let plist = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any],
          plist["CFBundleIdentifier"] as? String == "com.chloe.personal-assistant" else {
        fputs("Not a verified Chloe bundle: \(target.path)\n", stderr)
        exit(1)
    }
}
for target in targets {
    var destination: NSURL?
    try manager.trashItem(at: target, resultingItemURL: &destination)
    print("Moved to Trash: \(target.path)")
}
