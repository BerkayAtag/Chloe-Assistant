import AppKit
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let outputDirectory = CommandLine.arguments[1]
let sizes = [16, 32, 128, 256, 512]

func color(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat = 1) -> CGColor {
    CGColor(red: r, green: g, blue: b, alpha: a)
}

func render(_ size: Int, to url: URL) {
    let width = size
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    guard let context = CGContext(data: nil, width: width, height: width, bitsPerComponent: 8, bytesPerRow: width * 4, space: colorSpace, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return }
    let scale = CGFloat(width) / 1024
    context.scaleBy(x: scale, y: scale)
    let canvas = CGRect(x: 0, y: 0, width: 1024, height: 1024)
    context.saveGState()
    let rounded = CGPath(roundedRect: canvas, cornerWidth: 228, cornerHeight: 228, transform: nil)
    context.addPath(rounded); context.clip()
    let gradient = CGGradient(colorsSpace: colorSpace, colors: [color(0.008, 0.008, 0.01), color(0.025, 0.025, 0.03), color(0.055, 0.055, 0.065)] as CFArray, locations: [0, 0.52, 1])!
    context.drawLinearGradient(gradient, start: CGPoint(x: 0, y: 0), end: CGPoint(x: 1024, y: 1024), options: [])
    let halo = CGGradient(colorsSpace: colorSpace, colors: [color(0.8, 0.8, 0.8, 0.06), color(0, 0, 0, 0)] as CFArray, locations: [0, 1])!
    context.drawRadialGradient(halo, startCenter: CGPoint(x: 516, y: 430), startRadius: 0, endCenter: CGPoint(x: 516, y: 430), endRadius: 420, options: [])
    context.restoreGState()

    func cPath() -> CGPath {
        let path = CGMutablePath()
        path.move(to: CGPoint(x: 512, y: 210))
        path.addCurve(to: CGPoint(x: 810, y: 512), control1: CGPoint(x: 558, y: 420), control2: CGPoint(x: 604, y: 466))
        path.addCurve(to: CGPoint(x: 512, y: 814), control1: CGPoint(x: 604, y: 558), control2: CGPoint(x: 558, y: 604))
        path.addCurve(to: CGPoint(x: 214, y: 512), control1: CGPoint(x: 466, y: 604), control2: CGPoint(x: 420, y: 558))
        path.addCurve(to: CGPoint(x: 512, y: 210), control1: CGPoint(x: 420, y: 466), control2: CGPoint(x: 466, y: 420))
        path.closeSubpath()
        return path
    }
    context.saveGState()
    context.setShadow(offset: CGSize(width: 0, height: -16), blur: 32, color: color(0, 0, 0, 0.8))
    context.addPath(cPath()); context.setStrokeColor(color(0.065, 0.065, 0.065)); context.setLineWidth(24); context.setLineCap(.round); context.strokePath()
    context.restoreGState()
    context.saveGState()
    context.addPath(cPath()); context.clip()
    let metal = CGGradient(colorsSpace: colorSpace, colors: [color(0.26, 0.26, 0.26), color(0.64, 0.64, 0.64), color(0.32, 0.32, 0.32)] as CFArray, locations: [0, 0.7, 1])!
    context.drawLinearGradient(metal, start: CGPoint(x: 240, y: 240), end: CGPoint(x: 780, y: 820), options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
    context.restoreGState()
    context.addPath(cPath()); context.setStrokeColor(color(0.72, 0.72, 0.72, 0.65)); context.setLineWidth(3); context.strokePath()
    context.addEllipse(in: CGRect(x: 479, y: 479, width: 66, height: 66)); context.setFillColor(color(0.035, 0.035, 0.035)); context.fillPath()
    guard let image = context.makeImage(), let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else { return }
    CGImageDestinationAddImage(destination, image, nil); CGImageDestinationFinalize(destination)
}

let directory = URL(fileURLWithPath: outputDirectory)
for size in sizes {
    render(size, to: directory.appendingPathComponent("icon_\(size)x\(size).png"))
    render(size * 2, to: directory.appendingPathComponent("icon_\(size)x\(size)@2x.png"))
}
