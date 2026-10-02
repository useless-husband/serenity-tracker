// 畫 App 圖示：藍底圓角方塊＋白色走勢線（實色、不用漸層）
// 用法：swift icon.swift 輸出路徑.png
import AppKit

let size = 1024
let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon-1024.png"
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8,
                           samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                           bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

let tile = NSRect(x: 100, y: 100, width: 824, height: 824)
NSColor(red: 0x2a / 255.0, green: 0x78 / 255.0, blue: 0xd6 / 255.0, alpha: 1).setFill()
NSBezierPath(roundedRect: tile, xRadius: 185, yRadius: 185).fill()

// 淡淡的格線
NSColor(white: 1, alpha: 0.18).setStroke()
for y in [330.0, 512.0, 694.0] {
    let g = NSBezierPath()
    g.move(to: NSPoint(x: 230, y: y)); g.line(to: NSPoint(x: 794, y: y))
    g.lineWidth = 10
    g.stroke()
}

// 走勢線：先漲、大跌、再漲
let pts: [NSPoint] = [(230, 330), (360, 470), (450, 420), (560, 700), (650, 390), (794, 640)].map { NSPoint(x: $0.0, y: $0.1) }
let line = NSBezierPath()
line.move(to: pts[0])
pts.dropFirst().forEach { line.line(to: $0) }
line.lineWidth = 46
line.lineJoinStyle = .round
line.lineCapStyle = .round
NSColor.white.setStroke()
line.stroke()
NSColor.white.setFill()
NSBezierPath(ovalIn: NSRect(x: 794 - 44, y: 640 - 44, width: 88, height: 88)).fill()

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
print("OK \(out)")
