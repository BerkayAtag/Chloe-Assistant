import AppKit

guard CommandLine.arguments.count >= 3,
      let image = NSImage(contentsOfFile: CommandLine.arguments[1]) else {
    fputs("Usage: apply_bundle_icon.swift <icon.icns> <app bundle>\n", stderr)
    exit(1)
}
let bundlePath = URL(fileURLWithPath: CommandLine.arguments[2]).standardizedFileURL.path
guard NSWorkspace.shared.setIcon(image, forFile: bundlePath, options: []) else {
    fputs("Finder bundle icon could not be updated.\n", stderr)
    exit(1)
}
print("Finder bundle icon updated.")
if CommandLine.arguments.count == 4 {
    let current = NSWorkspace.shared.icon(forFile: bundlePath)
    current.size = NSSize(width: 512, height: 512)
    if let tiff = current.tiffRepresentation,
       let bitmap = NSBitmapImageRep(data: tiff),
       let png = bitmap.representation(using: .png, properties: [:]) {
        try png.write(to: URL(fileURLWithPath: CommandLine.arguments[3]))
    }
}
