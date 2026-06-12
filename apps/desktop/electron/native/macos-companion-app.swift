import AppKit
import Foundation
import SwiftUI

private struct CompanionSession: Codable, Identifiable, Hashable {
    let id: String
    let profile: String
    let title: String
    let preview: String
    let model: String
    let status: String
    let startedAt: Double
    let lastActive: Double

    enum CodingKeys: String, CodingKey {
        case id
        case profile
        case title
        case preview
        case model
        case status
        case startedAt = "started_at"
        case lastActive = "last_active"
    }
}

private struct CompanionInput: Codable {
    let type: String
    let connected: Bool?
    let sessions: [CompanionSession]?
    let displayId: String?
    let mode: String?
}

private struct CompanionOutput: Codable {
    let type: String
    var sessionId: String?
    var profile: String?
    var displayId: String?
}

private func emit(_ value: CompanionOutput) {
    guard let data = try? JSONEncoder().encode(value) else { return }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0a]))
}

@MainActor
private final class CompanionModel: ObservableObject {
    @Published var connected = false
    @Published var sessions: [CompanionSession] = []
    @Published var expanded = false
    @Published var displayId: String?

    var collapsedSize: CGSize {
        guard let screen = selectedScreen else {
            return CGSize(width: 330, height: 38)
        }
        let left = screen.auxiliaryTopLeftArea?.width ?? 0
        let right = screen.auxiliaryTopRightArea?.width ?? 0
        let hasNotch = screen.safeAreaInsets.top > 0 || left > 0 || right > 0
        let width = hasNotch ? max(180, screen.frame.width - left - right + 4) : 330
        let reservedTop = max(0, screen.frame.maxY - screen.visibleFrame.maxY)
        let height = hasNotch ? max(24, screen.safeAreaInsets.top) : max(38, reservedTop)
        return CGSize(width: width, height: height)
    }

    var selectedScreen: NSScreen? {
        guard let displayId,
              let numeric = UInt32(displayId) else {
            return NSScreen.main
        }
        let key = NSDeviceDescriptionKey("NSScreenNumber")
        return NSScreen.screens.first {
            ($0.deviceDescription[key] as? NSNumber)?.uint32Value == numeric
        } ?? NSScreen.main
    }

    var screenOptions: [(id: String, name: String)] {
        let key = NSDeviceDescriptionKey("NSScreenNumber")
        return NSScreen.screens.compactMap { screen in
            guard let number = screen.deviceDescription[key] as? NSNumber else { return nil }
            return (String(number.uint32Value), screen.localizedName)
        }
    }

    func apply(_ input: CompanionInput) {
        switch input.type {
        case "snapshot":
            connected = input.connected ?? false
            sessions = Array((input.sessions ?? []).prefix(6))
            if let displayId = input.displayId {
                self.displayId = displayId
            }
        case "display":
            displayId = input.displayId
        case "mode":
            expanded = input.mode == "expanded"
        case "quit":
            NSApplication.shared.terminate(nil)
        default:
            break
        }
    }
}

private struct BottomRoundedShape: Shape {
    let radius: CGFloat

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let r = min(radius, rect.width / 2, rect.height / 2)
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - r))
        path.addQuadCurve(
            to: CGPoint(x: rect.maxX - r, y: rect.maxY),
            control: CGPoint(x: rect.maxX, y: rect.maxY)
        )
        path.addLine(to: CGPoint(x: rect.minX + r, y: rect.maxY))
        path.addQuadCurve(
            to: CGPoint(x: rect.minX, y: rect.maxY - r),
            control: CGPoint(x: rect.minX, y: rect.maxY)
        )
        path.closeSubpath()
        return path
    }
}

private struct StatusDot: View {
    let status: String

    private var color: Color {
        switch status {
        case "waiting": return .orange
        case "working": return .green
        case "starting": return .yellow
        default: return .secondary
        }
    }

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 8, height: 8)
            .shadow(color: color.opacity(0.55), radius: status == "idle" ? 0 : 4)
    }
}

private struct CompanionView: View {
    @ObservedObject var model: CompanionModel
    let openSession: (CompanionSession) -> Void
    let openCenter: () -> Void
    let exitCompanion: () -> Void

    private let expandedSize = CGSize(width: 520, height: 390)
    private let openAnimation = Animation.spring(response: 0.42, dampingFraction: 0.8)

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .top) {
                Color.clear
                island
                    .frame(
                        width: model.expanded ? expandedSize.width : model.collapsedSize.width,
                        height: model.expanded ? expandedSize.height : model.collapsedSize.height,
                        alignment: .top
                    )
                    .clipShape(BottomRoundedShape(radius: model.expanded ? 22 : 15))
                    .shadow(color: .black.opacity(model.expanded ? 0.36 : 0.18), radius: 18, y: 8)
                    .animation(openAnimation, value: model.expanded)
                    .position(x: proxy.size.width / 2, y: (model.expanded ? expandedSize.height : model.collapsedSize.height) / 2)
            }
        }
        .frame(width: 560, height: 430)
        .preferredColorScheme(.dark)
    }

    private var island: some View {
        ZStack(alignment: .top) {
            Color(red: 0.035, green: 0.04, blue: 0.055)
            VStack(spacing: 0) {
                header
                    .frame(height: max(38, model.collapsedSize.height))
                if model.expanded {
                    sessionList
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }
        }
        .contentShape(BottomRoundedShape(radius: model.expanded ? 22 : 15))
        .contextMenu {
            Button("Open Session Center", action: openCenter)
            Menu("Display") {
                ForEach(model.screenOptions, id: \.id) { screen in
                    Button {
                        model.displayId = screen.id
                        emit(CompanionOutput(type: "setDisplay", displayId: screen.id))
                    } label: {
                        if screen.id == model.displayId {
                            Label(screen.name, systemImage: "checkmark")
                        } else {
                            Text(screen.name)
                        }
                    }
                }
            }
            Divider()
            Button("Exit Companion", role: .destructive, action: exitCompanion)
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(
                    LinearGradient(
                        colors: [.cyan, .blue, .purple],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .frame(width: 10, height: 10)
                .shadow(color: .cyan.opacity(0.65), radius: 5)
            Text("Hermes")
                .font(.system(size: 13, weight: .semibold, design: .rounded))
            Spacer(minLength: 8)
            Text(model.connected ? activeSummary : "Offline")
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundStyle(.secondary)
            if model.expanded {
                Button(action: openCenter) {
                    Image(systemName: "rectangle.stack")
                        .font(.system(size: 12, weight: .semibold))
                }
                .buttonStyle(.plain)
                .help("Open Session Center")
            }
        }
        .padding(.horizontal, model.expanded ? 18 : 14)
    }

    private var activeSummary: String {
        let count = model.sessions.filter { $0.status != "idle" }.count
        return count > 0 ? "\(count) active" : "Ready"
    }

    private var sessionList: some View {
        VStack(spacing: 0) {
            Divider().opacity(0.35)
            if model.sessions.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "checkmark.circle")
                        .font(.system(size: 24))
                        .foregroundStyle(.secondary)
                    Text("No active or recent sessions")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ForEach(model.sessions) { session in
                    Button {
                        openSession(session)
                    } label: {
                        HStack(spacing: 11) {
                            StatusDot(status: session.status)
                            VStack(alignment: .leading, spacing: 3) {
                                HStack(spacing: 7) {
                                    Text(session.title.isEmpty ? session.id.prefix(12) + "" : session.title)
                                        .font(.system(size: 12, weight: .semibold))
                                        .lineLimit(1)
                                    Text(session.profile)
                                        .font(.system(size: 9, weight: .semibold))
                                        .foregroundStyle(.secondary)
                                        .padding(.horizontal, 5)
                                        .padding(.vertical, 2)
                                        .background(.white.opacity(0.07), in: Capsule())
                                }
                                Text(session.preview.isEmpty ? session.model : session.preview)
                                    .font(.system(size: 10.5))
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                            Spacer()
                            Text(session.status.capitalized)
                                .font(.system(size: 9.5, weight: .medium))
                                .foregroundStyle(.secondary)
                        }
                        .padding(.horizontal, 18)
                        .frame(height: 52)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(CompanionRowButtonStyle())
                }
                Spacer(minLength: 0)
            }
        }
    }
}

private struct CompanionRowButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? Color.white.opacity(0.1) : Color.clear)
    }
}

@MainActor
private final class CompanionHostingView<Content: View>: NSHostingView<Content> {
    weak var model: CompanionModel?

    override var isOpaque: Bool { false }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func hitTest(_ point: NSPoint) -> NSView? {
        guard let model else { return nil }
        let size = model.expanded ? CGSize(width: 520, height: 390) : model.collapsedSize
        let rect = NSRect(
            x: (bounds.width - size.width) / 2,
            y: bounds.height - size.height,
            width: size.width,
            height: size.height
        )
        guard rect.contains(point) else { return nil }
        return super.hitTest(point) ?? self
    }
}

@MainActor
private final class CompanionController: NSObject, NSApplicationDelegate {
    private let model = CompanionModel()
    private var panel: NSPanel?
    private var globalMoveMonitor: Any?
    private var localMoveMonitor: Any?
    private var collapseTask: Task<Void, Never>?
    private var expandTask: Task<Void, Never>?
    private var lastMoveTime: TimeInterval = 0

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        createPanel()
        startInput()
        startMouseMonitors()
        emit(CompanionOutput(type: "ready"))
    }

    func applicationWillTerminate(_ notification: Notification) {
        if let globalMoveMonitor { NSEvent.removeMonitor(globalMoveMonitor) }
        if let localMoveMonitor { NSEvent.removeMonitor(localMoveMonitor) }
    }

    private func createPanel() {
        let frame = NSRect(x: 0, y: 0, width: 560, height: 430)
        let panel = NSPanel(
            contentRect: frame,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.level = .screenSaver
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        panel.isMovable = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.becomesKeyOnlyIfNeeded = true

        let view = CompanionView(
            model: model,
            openSession: { session in
                emit(CompanionOutput(type: "openSession", sessionId: session.id, profile: session.profile))
            },
            openCenter: {
                emit(CompanionOutput(type: "openCenter"))
            },
            exitCompanion: {
                emit(CompanionOutput(type: "exitCompanion"))
            }
        )
        let hosting = CompanionHostingView(rootView: view)
        hosting.model = model
        hosting.wantsLayer = true
        hosting.layer?.backgroundColor = NSColor.clear.cgColor
        panel.contentView = hosting
        self.panel = panel
        reposition()
        panel.orderFrontRegardless()
    }

    private func reposition() {
        guard let panel, let screen = model.selectedScreen ?? NSScreen.main else { return }
        panel.setFrameOrigin(
            NSPoint(
                x: screen.frame.midX - panel.frame.width / 2,
                y: screen.frame.maxY - panel.frame.height
            )
        )
    }

    private func startInput() {
        DispatchQueue.global(qos: .userInitiated).async {
            while let line = readLine() {
                guard let data = line.data(using: .utf8),
                      let input = try? JSONDecoder().decode(CompanionInput.self, from: data) else {
                    continue
                }
                Task { @MainActor [weak self] in
                    let previousDisplay = self?.model.displayId
                    self?.model.apply(input)
                    if previousDisplay != self?.model.displayId {
                        self?.reposition()
                    }
                }
            }
            Task { @MainActor in
                NSApplication.shared.terminate(nil)
            }
        }
    }

    private func startMouseMonitors() {
        globalMoveMonitor = NSEvent.addGlobalMonitorForEvents(matching: .mouseMoved) { [weak self] _ in
            Task { @MainActor in self?.handleMouseMove() }
        }
        localMoveMonitor = NSEvent.addLocalMonitorForEvents(matching: .mouseMoved) { [weak self] event in
            Task { @MainActor in self?.handleMouseMove() }
            return event
        }
    }

    private func handleMouseMove() {
        let now = ProcessInfo.processInfo.systemUptime
        guard now - lastMoveTime >= 0.05, let panel else { return }
        lastMoveTime = now

        let size = model.expanded ? CGSize(width: 520, height: 390) : model.collapsedSize
        let interactiveRect = NSRect(
            x: panel.frame.midX - size.width / 2,
            y: panel.frame.maxY - size.height,
            width: size.width,
            height: size.height
        )
        let inside = interactiveRect.contains(NSEvent.mouseLocation)

        if inside {
            collapseTask?.cancel()
            guard !model.expanded else { return }
            expandTask?.cancel()
            expandTask = Task { @MainActor [weak self] in
                try? await Task.sleep(for: .milliseconds(120))
                guard !Task.isCancelled else { return }
                withAnimation(.spring(response: 0.42, dampingFraction: 0.8)) {
                    self?.model.expanded = true
                }
            }
        } else {
            expandTask?.cancel()
            guard model.expanded else { return }
            collapseTask?.cancel()
            collapseTask = Task { @MainActor [weak self] in
                try? await Task.sleep(for: .milliseconds(450))
                guard !Task.isCancelled else { return }
                withAnimation(.smooth(duration: 0.3)) {
                    self?.model.expanded = false
                }
            }
        }
    }
}

@main
private struct HermesCompanionApp {
    static func main() {
        let app = NSApplication.shared
        let delegate = CompanionController()
        app.delegate = delegate
        app.run()
        _ = delegate
    }
}
