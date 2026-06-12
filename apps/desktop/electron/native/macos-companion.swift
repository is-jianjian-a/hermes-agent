import AppKit
import CoreGraphics
import Foundation

struct DisplayGeometry: Codable {
    let id: UInt32
    let name: String
    let frame: [String: Double]
    let visibleFrame: [String: Double]
    let safeAreaTop: Double
    let notchWidth: Double
    let notchHeight: Double
    let hasNotch: Bool
}

func rect(_ value: NSRect) -> [String: Double] {
    [
        "x": value.origin.x,
        "y": value.origin.y,
        "width": value.size.width,
        "height": value.size.height,
    ]
}

let key = NSDeviceDescriptionKey("NSScreenNumber")
let rows = NSScreen.screens.compactMap { screen -> DisplayGeometry? in
    guard let number = screen.deviceDescription[key] as? NSNumber else {
        return nil
    }
    let left = screen.auxiliaryTopLeftArea?.width ?? 0
    let right = screen.auxiliaryTopRightArea?.width ?? 0
    let hasNotch = screen.safeAreaInsets.top > 0 || left > 0 || right > 0
    let notchWidth = hasNotch ? max(0, screen.frame.width - left - right + 4) : 190
    let reservedTop = max(0, screen.frame.maxY - screen.visibleFrame.maxY)
    let notchHeight = hasNotch ? screen.safeAreaInsets.top : max(24, reservedTop)
    return DisplayGeometry(
        id: number.uint32Value,
        name: screen.localizedName,
        frame: rect(screen.frame),
        visibleFrame: rect(screen.visibleFrame),
        safeAreaTop: screen.safeAreaInsets.top,
        notchWidth: notchWidth,
        notchHeight: notchHeight,
        hasNotch: hasNotch
    )
}

let data = try JSONEncoder().encode(rows)
FileHandle.standardOutput.write(data)
