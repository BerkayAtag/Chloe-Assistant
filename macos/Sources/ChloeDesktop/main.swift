import AppKit
import WebKit
import ApplicationServices
import AVFoundation
import Speech

// Audio taps run on an audio queue, never on the AppKit main actor.
nonisolated private func installSpeechTap(input: AVAudioInputNode, format: AVAudioFormat, request: SFSpeechAudioBufferRecognitionRequest, activity: @escaping @Sendable () -> Void) {
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
        request.append(buffer)
        if let samples = buffer.floatChannelData?[0], buffer.frameLength > 0 {
            var power: Float = 0
            for index in 0..<Int(buffer.frameLength) { power += samples[index] * samples[index] }
            if sqrt(power / Float(buffer.frameLength)) > 0.015 { activity() }
        }
    }
}

@MainActor
final class ChloeDesktopApp: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, AVSpeechSynthesizerDelegate {
    private var window: NSWindow!
    private var detailView = NSView()
    private var primaryWebView: WKWebView?
    private var browserView: WKWebView?
    private var addressField: NSTextField?
    private var bridgeHandlers: [NativeBridgeHandler] = []
    private let statusLabel = NSTextField(labelWithString: "Hazır")
    private var browserWindow: NSWindow?
    private var computerWindow: NSWindow?
    private var codexWindow: NSWindow?
    private var codePathField: NSTextField?
    private var codeEditor: NSTextView?
    private var codeCommandField: NSTextField?
    private var codeInstructionField: NSTextField?
    private var codeEditButton: NSButton?
    private var codeOutput: NSTextView?
    private var computerCommandField: NSTextField?
    private var computerOutput: NSTextField?
    private var computerCommand: BoundedCommand?
    private var codeCommand: BoundedCommand?
    private var fullAccessMode = false
    private var speechRecognizer: SFSpeechRecognizer?
    private var speechEngine: AVAudioEngine?
    private var speechRequest: SFSpeechAudioBufferRecognitionRequest?
    private var speechTask: SFSpeechRecognitionTask?
    private var speechGeneration = 0
    private var speechAuthorizationInProgress = false
    private var speechTapInstalled = false
    private var speechSilenceTimer: Timer?
    private var speechSilenceInterval: TimeInterval = 2.4
    private var speechNoInputTimer: Timer?
    private var speechFinalizationTimer: Timer?
    private var speechLastTranscript = ""
    private var speechCommittedTranscript = ""
    private var speechSegment = 0
    private var speechAutoSend = true
    private var speechLastActivity: TimeInterval = 0
    private var speechSessionTimer: Timer?
    private var webServerProcess: Process?
    private var serverIsBundled = false
    private var serverProbeInProgress = false
    private var startupRetries = 0
    private let voiceSynthesizer = AVSpeechSynthesizer()
    private var activeUtterance: ObjectIdentifier?
    private var voiceRequestId = ""

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        buildMenu()
        voiceSynthesizer.delegate = self
        if let icon = NSImage(contentsOf: Bundle.main.url(forResource: "Chloe", withExtension: "icns") ?? URL(fileURLWithPath: "")) {
            NSApp.applicationIconImage = icon
        }
        NSApp.activate(ignoringOtherApps: true)
        buildWindow()
        startLocalServer()
        showChloe()
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.window.isReleasedWhenClosed = false
            self.window.makeKeyAndOrderFront(nil)
            self.window.orderFrontRegardless()
            NSApp.activate(ignoringOtherApps: true)
        }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ notification: Notification) {
        computerCommand?.cancel()
        codeCommand?.cancel()
        stopDictation(notifyWebView: false)
        voiceSynthesizer.stopSpeaking(at: .immediate)
        // A source install shares its server with browser sessions, so it keeps
        // running. The DMG app owns the server it started inside its bundle.
        if serverIsBundled { webServerProcess?.terminate() }
    }

    private func buildMenu() {
        let menu = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu(title: "Chloe")
        appMenu.addItem(withTitle: "Chloe’yi Gizle", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        let quit = appMenu.addItem(withTitle: "Chloe’den Çık", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        quit.target = NSApp
        appItem.submenu = appMenu
        menu.addItem(appItem)

        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "Düzenle")
        for (title, action, key) in [
            ("Geri Al", "undo:", "z"), ("Kes", "cut:", "x"),
            ("Kopyala", "copy:", "c"), ("Yapıştır", "paste:", "v"),
            ("Tümünü Seç", "selectAll:", "a")
        ] {
            editMenu.addItem(withTitle: title, action: NSSelectorFromString(action), keyEquivalent: key)
        }
        editItem.submenu = editMenu
        menu.addItem(editItem)
        NSApp.mainMenu = menu
    }

    private func startLocalServer() {
        if webServerProcess?.isRunning == true || serverProbeInProgress { return }
        // Reuse the shared web server. Do not start a second process or ask for
        // filesystem access when the web app is already ready.
        serverProbeInProgress = true
        Task { [weak self] in
            guard let self else { return }
            defer { self.serverProbeInProgress = false }
            let request = URLRequest(url: URL(string: "http://127.0.0.1:3004/")!, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 2)
            if let (data, response) = try? await URLSession.shared.data(for: request),
               (response as? HTTPURLResponse)?.statusCode == 200,
               String(data: data, encoding: .utf8)?.contains("Chloe") == true { return }
            self.launchLocalServer()
        }
    }

    private func launchLocalServer() {
        // The DMG build carries its own Node and standalone server in Resources.
        if let resources = Bundle.main.resourceURL {
            let server = resources.appendingPathComponent("server", isDirectory: true)
            let node = resources.appendingPathComponent("runtime/node")
            if FileManager.default.fileExists(atPath: server.appendingPathComponent("server.js").path),
               FileManager.default.isExecutableFile(atPath: node.path) {
                launchBundledServer(server: server, node: node)
                return
            }
        }
        // SwiftPM GUI launches do not always report the enclosing .app as
        // Bundle.main. Resolve from the actual executable as a fallback.
        var project = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent()
        // Applications installs are no longer next to the source checkout.
        let config = Bundle.main.url(forResource: "ChloeRuntime", withExtension: "plist")
            .flatMap { NSDictionary(contentsOf: $0) }
        if let configuredRoot = config?["projectRoot"] as? String {
            project = URL(fileURLWithPath: configuredRoot)
        }
        if !FileManager.default.fileExists(atPath: project.appendingPathComponent("node_modules/next/dist/bin/next").path) {
            project = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent()
            for _ in 0..<6 {
                if FileManager.default.fileExists(atPath: project.appendingPathComponent("node_modules/next/dist/bin/next").path) { break }
                project.deleteLastPathComponent()
            }
        }
        let nodeCandidates = [config?["nodePath"] as? String, "/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"].compactMap { $0 }
        guard let node = nodeCandidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) else {
            NSLog("Chloe: Node.js bulunamadı. Kurulum betiğini yeniden çalıştır.")
            return
        }
        let entry = project.appendingPathComponent("node_modules/next/dist/bin/next")
        guard FileManager.default.fileExists(atPath: entry.path) else {
            NSLog("Chloe server entry not found: %@", entry.path)
            return
        }
        let process = Process()
        // Detach the shared server; do not install a login item or service.
        process.executableURL = URL(fileURLWithPath: "/usr/bin/nohup")
        let log = project.appendingPathComponent(".next/chloe-server.log").path
        process.arguments = [node, entry.path, "start", project.path, "-H", "127.0.0.1", "-p", "3004"]
        process.currentDirectoryURL = project
        if !FileManager.default.fileExists(atPath: log) { FileManager.default.createFile(atPath: log, contents: nil) }
        let output = FileHandle(forWritingAtPath: log) ?? FileHandle.nullDevice
        output.seekToEndOfFile()
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = output
        process.standardError = output
        do { try process.run(); webServerProcess = process } catch { NSLog("Chloe server startup: %@", error.localizedDescription) }
    }

    /// The app bundle is read-only once installed, so user data lives in
    /// Application Support and the server log in ~/Library/Logs/Chloe.
    private func launchBundledServer(server: URL, node: URL) {
        let files = FileManager.default
        let support = files.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Chloe", isDirectory: true)
        let data = support.appendingPathComponent("data", isDirectory: true)
        let logs = files.urls(for: .libraryDirectory, in: .userDomainMask)[0].appendingPathComponent("Logs/Chloe", isDirectory: true)
        try? files.createDirectory(at: data, withIntermediateDirectories: true)
        try? files.createDirectory(at: logs, withIntermediateDirectories: true)
        let logPath = logs.appendingPathComponent("server.log").path
        files.createFile(atPath: logPath, contents: nil)
        let output = FileHandle(forWritingAtPath: logPath) ?? FileHandle.nullDevice
        let process = Process()
        process.executableURL = node
        process.arguments = [server.appendingPathComponent("server.js").path]
        process.currentDirectoryURL = server
        var environment = ProcessInfo.processInfo.environment
        environment["PORT"] = "3004"
        environment["HOSTNAME"] = "127.0.0.1"
        environment["NODE_ENV"] = "production"
        environment["NEXT_TELEMETRY_DISABLED"] = "1"
        environment["CHLOE_DATA_DIR"] = data.path
        process.environment = environment
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = output
        process.standardError = output
        do {
            try process.run()
            webServerProcess = process
            serverIsBundled = true
        } catch { NSLog("Chloe bundled server startup: %@", error.localizedDescription) }
    }

    private func buildWindow() {
        let root = NSView()
        let detailController = NSViewController()
        detailView = NSView()
        detailController.view = root
        detailView.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(detailView)
        NSLayoutConstraint.activate([
            detailView.topAnchor.constraint(equalTo: root.topAnchor),
            detailView.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            detailView.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            detailView.bottomAnchor.constraint(equalTo: root.bottomAnchor),
        ])
        window = NSWindow(contentViewController: detailController)
        window.title = "Chloe"
        window.titleVisibility = .hidden
        window.setFrameAutosaveName("")
        window.isRestorable = false
        let visibleFrame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let width = min(1440, visibleFrame.width - 80)
        let height = min(920, visibleFrame.height - 80)
        window.setFrame(NSRect(x: visibleFrame.midX - width / 2, y: visibleFrame.midY - height / 2, width: width, height: height), display: false)
        window.minSize = NSSize(width: 980, height: 650)
        window.styleMask = [.titled, .closable, .miniaturizable, .resizable]
        window.isMovableByWindowBackground = true
        window.makeKeyAndOrderFront(nil)
    }

    fileprivate func handleNativeAction(_ action: String) {
        handleNativeAction(action, url: nil, command: nil)
    }

    fileprivate func handleNativeAction(_ action: String, url: String?, command: String?, speechId: String = "", rate: Double = 0.96, pitch: Double = 1, silenceMs: Double? = nil, autoSend: Bool = true) {
        switch action {
        case "chooseWorkspace":
            let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false
            panel.prompt = "Proje klasörünü seç"
            if panel.runModal() == .OK, let path = panel.url?.path,
               let data = try? JSONSerialization.data(withJSONObject: ["path": path]), let json = String(data: data, encoding: .utf8) {
                primaryWebView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('chloeWorkspace',{detail:\(json)}));")
            }
        case "openBrowser":
            showBrowserWindow(url: url, command: command)
        case "openMacManagement":
            showComputerWindow(command: command)
        case "openCodex":
            showCodexWindow()
        case "startDictation":
            startDictation(fast: command == "fast", silenceMs: silenceMs, autoSend: autoSend)
        case "finishDictation":
            finishDictationInput(generation: speechGeneration)
        case "stopDictation":
            stopDictation()
        case "getSpeechVoices":
            let voices = AVSpeechSynthesisVoice.speechVoices().filter { $0.language.hasPrefix("tr") && $0.gender == .female }
            emitVoiceEvent(["voices": voices.map { ["voiceURI": $0.identifier, "name": $0.name, "lang": $0.language] }])
        case "speakText":
            activeUtterance = nil
            voiceSynthesizer.stopSpeaking(at: .immediate)
            voiceRequestId = speechId
            guard let text = command, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
            let voices = AVSpeechSynthesisVoice.speechVoices().filter { $0.language.hasPrefix("tr") && $0.gender == .female }
            guard let voice = voices.first(where: { $0.identifier == url || $0.name == url }) ?? voices.first else {
                emitVoiceEvent(["id": speechId, "error": "Türkçe kadın sesi bulunamadı. Sistem Ayarları > Erişilebilirlik > Konuşulan İçerik bölümünden Türkçe ses indir."])
                return
            }
            stopDictation()
            let utterance = AVSpeechUtterance(string: String(text.prefix(50_000)))
            utterance.voice = voice
            utterance.rate = AVSpeechUtteranceDefaultSpeechRate * Float(min(1.5, max(0.5, rate)))
            utterance.pitchMultiplier = Float(min(2, max(0.5, pitch)))
            activeUtterance = ObjectIdentifier(utterance)
            voiceSynthesizer.speak(utterance)
        case "stopSpeaking":
            activeUtterance = nil
            voiceSynthesizer.stopSpeaking(at: .immediate)
            emitVoiceEvent(["id": voiceRequestId, "stopped": true])
        case "openSpeechSettings":
            openSpeechRecognitionSettings()
        case "openMicrophoneSettings":
            openMicrophoneSettings()
        default:
            break
        }
    }

    private func emitVoiceEvent(_ detail: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: detail),
              let json = String(data: data, encoding: .utf8) else { return }
        primaryWebView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('chloeNativeVoice',{detail:\(json)}));")
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
        let id = ObjectIdentifier(utterance)
        Task { @MainActor [weak self] in
            guard let self, self.activeUtterance == id else { return }
            self.emitVoiceEvent(["id": self.voiceRequestId, "started": true])
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        let id = ObjectIdentifier(utterance)
        Task { @MainActor [weak self] in
            guard let self, self.activeUtterance == id else { return }
            self.activeUtterance = nil
            self.emitVoiceEvent(["id": self.voiceRequestId, "finished": true])
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        let id = ObjectIdentifier(utterance)
        Task { @MainActor [weak self] in
            guard let self, self.activeUtterance == id else { return }
            self.activeUtterance = nil
            self.emitVoiceEvent(["id": self.voiceRequestId, "stopped": true])
        }
    }

    private func startDictation(fast: Bool = false, silenceMs: Double? = nil, autoSend: Bool = true) {
        guard primaryWebView != nil else { return }
        guard speechEngine == nil, speechTask == nil, !speechAuthorizationInProgress else { return }
        // Sessizlik eşiği turun bittiğini belirler. 0,9 sn gibi kısa bir değer
        // cümle ortasındaki doğal duraklamada mikrofonu kapatıyordu; artık
        // istemci açıkça gönderir, göndermezse güvenli varsayılan kullanılır.
        if let silenceMs, silenceMs >= 600 {
            speechSilenceInterval = min(max(silenceMs / 1000, 0.6), 8)
        } else {
            speechSilenceInterval = fast ? 1.9 : 2.4
        }
        speechGeneration += 1
        let generation = speechGeneration
        speechAuthorizationInProgress = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self] in
            guard let self, self.speechGeneration == generation, self.speechAuthorizationInProgress else { return }
            self.stopDictation(notifyWebView: false)
            self.emitSpeechEvent(error: "macOS mikrofon/konuşma tanıma izni yanıt vermedi. Sistem Ayarları > Gizlilik ve Güvenlik içindeki Mikrofon ve Konuşma Tanıma izinlerini kontrol et; sonra yeniden dene.", stopped: true)
        }
        speechLastTranscript = ""
        speechCommittedTranscript = ""
        speechAutoSend = autoSend
        emitSpeechEvent(starting: true)

        let authorizationStatus = SFSpeechRecognizer.authorizationStatus()
        if authorizationStatus == .notDetermined {
            SFSpeechRecognizer.requestAuthorization { @Sendable [weak self] status in
                DispatchQueue.main.async { [weak self] in
                    self?.continueDictationAuthorization(status, generation: generation)
                }
            }
        } else {
            continueDictationAuthorization(authorizationStatus, generation: generation)
        }
    }

    private func continueDictationAuthorization(
        _ status: SFSpeechRecognizerAuthorizationStatus,
        generation: Int
    ) {
        guard speechGeneration == generation, speechAuthorizationInProgress else { return }
        guard status == .authorized else {
            failDictation("macOS Konuşma Tanıma izni gerekli. Sistem Ayarları > Gizlilik ve Güvenlik > Konuşma Tanıma bölümünden Chloe'ye izin ver.")
            return
        }
        AVCaptureDevice.requestAccess(for: .audio) { @Sendable [weak self] allowed in
            DispatchQueue.main.async { [weak self] in
                guard let self,
                      self.speechGeneration == generation,
                      self.speechAuthorizationInProgress else { return }
                guard allowed else {
                    self.failDictation("Mikrofon izni verilmedi. Sistem Ayarları > Gizlilik ve Güvenlik > Mikrofon bölümünden Chloe'ye izin ver.")
                    return
                }
                self.startSpeechRecognition(generation: generation)
            }
        }
    }

    private func startSpeechRecognition(generation: Int) {
        guard speechGeneration == generation, speechAuthorizationInProgress else { return }
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "tr-TR")),
              recognizer.isAvailable else {
            failDictation("macOS Türkçe konuşma tanıma şu anda kullanılamıyor.")
            return
        }
        let engine = AVAudioEngine()
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.requiresOnDeviceRecognition = recognizer.supportsOnDeviceRecognition
        let input = engine.inputNode
        let format = input.inputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            failDictation("Mikrofonun ses biçimi alınamadı. Mikrofonu kontrol edip tekrar dene.")
            return
        }
        installSpeechTap(input: input, format: format, request: request) { [weak self] in
            Task { @MainActor [weak self] in
                guard let self, self.speechGeneration == generation else { return }
                self.speechLastActivity = ProcessInfo.processInfo.systemUptime
            }
        }
        speechTapInstalled = true
        engine.prepare()
        do {
            try engine.start()
        } catch {
            engine.stop()
            input.removeTap(onBus: 0)
            speechTapInstalled = false
            failDictation("Mikrofon başlatılamadı: \(error.localizedDescription)")
            return
        }
        speechRecognizer = recognizer
        speechEngine = engine
        speechRequest = request
        speechAuthorizationInProgress = false
        beginSpeechTask(recognizer: recognizer, request: request, generation: generation)
        speechSessionTimer?.invalidate()
        speechSessionTimer = Timer.scheduledTimer(withTimeInterval: 120, repeats: false) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.speechGeneration == generation else { return }
                self.failDictation("Mikrofon 2 dakikalık güvenlik sınırında durdu. Metin ekranda korundu; yeniden başlatabilirsin.")
            }
        }
        speechNoInputTimer?.invalidate()
        speechNoInputTimer = Timer.scheduledTimer(withTimeInterval: 15, repeats: false) { [weak self] _ in
            DispatchQueue.main.async { [weak self] in
                guard let self,
                      self.speechGeneration == generation,
                      self.speechLastTranscript.isEmpty else { return }
                self.failDictation("Ses algılanmadı. Mikrofona konuşup tekrar dene.")
            }
        }
        emitSpeechEvent(started: true, onDevice: recognizer.supportsOnDeviceRecognition)
    }

    private func beginSpeechTask(recognizer: SFSpeechRecognizer, request: SFSpeechAudioBufferRecognitionRequest, generation: Int) {
        speechSegment += 1
        let segment = speechSegment
        speechTask = recognizer.recognitionTask(with: request) { @Sendable [weak self] result, error in
            let text = result?.bestTranscription.formattedString
            let isFinal = result?.isFinal == true
            let errorMessage = error?.localizedDescription
            DispatchQueue.main.async { [weak self] in
                guard self?.speechSegment == segment else { return }
                self?.handleSpeechRecognitionUpdate(
                    text: text,
                    isFinal: isFinal,
                    errorMessage: errorMessage,
                    generation: generation
                )
            }
        }
    }

    private func continueSpeechSegment(generation: Int) {
        guard speechGeneration == generation, let engine = speechEngine, let recognizer = speechRecognizer else { return }
        speechSegment += 1 // Ignore the cancelled recognizer's late callbacks.
        speechTask?.cancel()
        speechRequest?.endAudio()
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.requiresOnDeviceRecognition = recognizer.supportsOnDeviceRecognition
        let input = engine.inputNode
        if speechTapInstalled { input.removeTap(onBus: 0) }
        installSpeechTap(input: input, format: input.inputFormat(forBus: 0), request: request) { [weak self] in
            Task { @MainActor [weak self] in
                guard let self, self.speechGeneration == generation else { return }
                self.speechLastActivity = ProcessInfo.processInfo.systemUptime
            }
        }
        speechTapInstalled = true
        speechRequest = request
        beginSpeechTask(recognizer: recognizer, request: request, generation: generation)
    }

    private func finishAfterSilence(generation: Int) {
        guard speechGeneration == generation, speechAutoSend else { return }
        let remaining = speechSilenceInterval - (ProcessInfo.processInfo.systemUptime - speechLastActivity)
        if remaining > 0 {
            speechSilenceTimer = Timer.scheduledTimer(withTimeInterval: remaining, repeats: false) { [weak self] _ in
                Task { @MainActor [weak self] in self?.finishAfterSilence(generation: generation) }
            }
        } else { finishDictationInput(generation: generation) }
    }

    private func handleSpeechRecognitionUpdate(
        text: String?,
        isFinal: Bool,
        errorMessage: String?,
        generation: Int
    ) {
        guard speechGeneration == generation else { return }
        if let text, !text.isEmpty {
            let combined = [speechCommittedTranscript, text].filter { !$0.isEmpty }.joined(separator: " ")
            if combined != speechLastTranscript {
                speechLastTranscript = combined
                speechLastActivity = ProcessInfo.processInfo.systemUptime
                speechNoInputTimer?.invalidate()
                speechNoInputTimer = nil
                speechSilenceTimer?.invalidate()
                if speechAutoSend {
                    speechSilenceTimer = Timer.scheduledTimer(withTimeInterval: speechSilenceInterval, repeats: false) { [weak self] _ in
                        DispatchQueue.main.async { [weak self] in
                            self?.finishAfterSilence(generation: generation)
                        }
                    }
                }
            }
            emitSpeechEvent(text: combined, isFinal: false)
            if isFinal { speechCommittedTranscript = combined }
        }
        if let errorMessage {
            stopDictation(notifyWebView: false)
            emitSpeechEvent(error: "Ses tanıma başarısız: \(errorMessage)", stopped: true)
        } else if isFinal {
            continueSpeechSegment(generation: generation)
        }
    }

    private func finishDictationInput(generation: Int) {
        guard speechGeneration == generation,
              !speechLastTranscript.isEmpty else { return }
        let text = speechLastTranscript
        // The latest stable partial is already displayed. Do not add an extra
        // network finalization wait after the user explicitly finishes/silence.
        stopDictation(notifyWebView: false)
        emitSpeechEvent(text: text, isFinal: true)
    }

    private func failDictation(_ message: String) {
        speechAuthorizationInProgress = false
        if speechEngine != nil || speechTapInstalled {
            stopDictation(notifyWebView: false)
        }
        emitSpeechEvent(error: message, stopped: true)
    }

    private func stopDictation(notifyWebView: Bool = true) {
        speechGeneration += 1
        speechSessionTimer?.invalidate()
        speechSessionTimer = nil
        speechAuthorizationInProgress = false
        speechSilenceTimer?.invalidate()
        speechSilenceTimer = nil
        speechNoInputTimer?.invalidate()
        speechNoInputTimer = nil
        speechFinalizationTimer?.invalidate()
        speechFinalizationTimer = nil
        speechLastTranscript = ""
        speechCommittedTranscript = ""
        if let engine = speechEngine {
            engine.stop()
            if speechTapInstalled {
                engine.inputNode.removeTap(onBus: 0)
                speechTapInstalled = false
            }
        } else if speechTapInstalled {
            speechTapInstalled = false
        }
        speechRequest?.endAudio()
        speechTask?.cancel()
        speechEngine = nil
        speechRequest = nil
        speechTask = nil
        speechRecognizer = nil
        if notifyWebView { emitSpeechEvent(stopped: true) }
    }

    private func emitSpeechEvent(
        text: String? = nil,
        isFinal: Bool = false,
        error: String? = nil,
        starting: Bool = false,
        started: Bool = false,
        stopped: Bool = false,
        onDevice: Bool? = nil
    ) {
        var detail: [String: Any] = [
            "final": isFinal,
            "starting": starting,
            "started": started,
            "stopped": stopped,
        ]
        if let text { detail["text"] = text }
        if let error { detail["error"] = error }
        if let onDevice { detail["onDevice"] = onDevice }
        guard JSONSerialization.isValidJSONObject(detail),
              let data = try? JSONSerialization.data(withJSONObject: detail),
              let json = String(data: data, encoding: .utf8) else { return }
        primaryWebView?.evaluateJavaScript(
            "window.dispatchEvent(new CustomEvent('chloeNativeSpeechResult',{detail:\(json)}));"
        )
    }

    private func resetDetail() { detailView.subviews.forEach { $0.removeFromSuperview() }; primaryWebView = nil; browserView = nil; addressField = nil }
    private func showChloe() {
        resetDetail()
        let web = makeWebView(URL(string: "http://127.0.0.1:3004/?native=1")!)
        primaryWebView = web
        detailView.addSubview(web)
        pin(web, to: detailView)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if webView === primaryWebView, (error as NSError).code == NSURLErrorCannotConnectToHost, startupRetries < 15 {
            startupRetries += 1
            startLocalServer()
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak webView] in
                webView?.load(URLRequest(url: URL(string: "http://127.0.0.1:3004/?native=1")!, cachePolicy: .reloadIgnoringLocalCacheData))
            }
            return
        }
        showWebLoadError(for: webView, error: error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showWebLoadError(for: webView, error: error)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView === primaryWebView, webView.superview !== detailView else { return }
        detailView.subviews.forEach { $0.removeFromSuperview() }
        detailView.addSubview(webView)
        pin(webView, to: detailView)
    }

    private func showWebLoadError(for webView: WKWebView, error: Error) {
        guard webView === primaryWebView else { return }
        let root = NSStackView()
        root.orientation = .vertical
        root.alignment = .centerX
        root.spacing = 12
        root.edgeInsets = NSEdgeInsets(top: 36, left: 28, bottom: 28, right: 28)
        root.translatesAutoresizingMaskIntoConstraints = false

        let title = NSTextField(labelWithString: "Chloe sunucusuna bağlanılamadı")
        title.font = .systemFont(ofSize: 22, weight: .semibold)
        let detail = NSTextField(wrappingLabelWithString: "Yerel web servisine ulaşılamadı. macOS Chloe için Belgeler klasörü izni soruyorsa önce bu isteği yanıtlayın. Sistem Ayarları → Gizlilik ve Güvenlik → Dosyalar ve Klasörler bölümünden kontrol edebilirsiniz. İzinler uygulama tarafından otomatik verilemez. Ardından Yeniden Dene'ye basın. Gerekirse proje klasöründe ./script/build_and_run.sh komutunu çalıştırın. Ayrıntı: \(error.localizedDescription)")
        detail.alignment = .center
        detail.textColor = .secondaryLabelColor
        detail.maximumNumberOfLines = 0
        let retry = button("Yeniden Dene") { [weak self, weak webView] in
            self?.startupRetries = 0
            self?.startLocalServer()
            webView?.load(URLRequest(url: URL(string: "http://127.0.0.1:3004/?native=1")!))
        }
        let openBrowser = button("Tarayıcıda Aç") {
            NSWorkspace.shared.open(URL(string: "http://127.0.0.1:3004/")!)
        }
        root.addArrangedSubview(title)
        root.addArrangedSubview(detail)
        root.addArrangedSubview(retry)
        root.addArrangedSubview(openBrowser)
        detailView.subviews.forEach { $0.removeFromSuperview() }
        detailView.addSubview(root)
        pin(root, to: detailView)
    }
    private func showBrowserWindow(url: String? = nil, command: String? = nil) {
        if let browserWindow {
            browserWindow.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            if let target = browserURL(from: url ?? command) { browserView?.load(URLRequest(url: target)); addressField?.stringValue = target.absoluteString }
            return
        }
        let root = NSView()
        let toolbar = NSStackView(); toolbar.orientation = .horizontal; toolbar.spacing = 8; toolbar.edgeInsets = NSEdgeInsets(top: 10, left: 10, bottom: 10, right: 10); toolbar.translatesAutoresizingMaskIntoConstraints = false
        let field = NSTextField(string: "https://www.google.com"); field.placeholderString = "Web adresi veya arama"; field.target = self; field.action = #selector(addressSubmitted); field.translatesAutoresizingMaskIntoConstraints = false; field.widthAnchor.constraint(greaterThanOrEqualToConstant: 360).isActive = true
        addressField = field
        let initial = browserURL(from: url ?? command) ?? URL(string: "https://www.google.com")!
        let web = makeWebView(initial); browserView = web
        field.stringValue = initial.absoluteString
        [button("Geri") { [weak self] in self?.browserView?.goBack() }, button("İleri") { [weak self] in self?.browserView?.goForward() }, button("Yenile") { [weak self] in self?.browserView?.reload() }, field, button("Git") { [weak self] in self?.navigateBrowser() }].forEach { toolbar.addArrangedSubview($0) }
        root.addSubview(toolbar); root.addSubview(web)
        [toolbar.topAnchor.constraint(equalTo: root.topAnchor), toolbar.leadingAnchor.constraint(equalTo: root.leadingAnchor), toolbar.trailingAnchor.constraint(equalTo: root.trailingAnchor), web.topAnchor.constraint(equalTo: toolbar.bottomAnchor), web.leadingAnchor.constraint(equalTo: root.leadingAnchor), web.trailingAnchor.constraint(equalTo: root.trailingAnchor), web.bottomAnchor.constraint(equalTo: root.bottomAnchor)].forEach { $0.isActive = true }
        let controller = NSViewController(); controller.view = root
        let panel = NSWindow(contentViewController: controller); panel.title = "Tarayıcı Yönetimi"; panel.minSize = NSSize(width: 980, height: 650); panel.setFrame(NSRect(x: 120, y: 100, width: 1280, height: 820), display: false); panel.isReleasedWhenClosed = false
        browserWindow = panel; panel.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
    }
    @objc private func addressSubmitted() { navigateBrowser() }
    private func navigateBrowser() {
        guard let field = addressField, let web = browserView else { return }
        guard let url = browserURL(from: field.stringValue) else { statusLabel.stringValue = "Geçersiz web adresi."; return }
        web.load(URLRequest(url: url))
    }

    private func browserURL(from raw: String?) -> URL? {
        guard var value = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
        // Composer commands may contain an address followed by Turkish prose.
        // Extract the address instead of attempting to parse the whole sentence.
        if let range = value.range(of: #"(?:https?://|www\.)[^\s]+"#, options: .regularExpression) {
            value = String(value[range]).trimmingCharacters(in: CharacterSet(charactersIn: ".,;!?\"'()"))
        } else if let range = value.range(of: #"(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?:/[^\s]*)?"#, options: .regularExpression) {
            value = String(value[range])
        }
        if value.hasPrefix("http://") || value.hasPrefix("https://") { return URL(string: value) }
        if value.hasPrefix("www.") { return URL(string: "https://" + value) }
        if value.contains(" ") { return URL(string: "https://www.google.com/search?q=" + (value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? value)) }
        value = "https://" + value
        return URL(string: value)
    }

    private func showComputerWindow(command: String? = nil) {
        if let computerWindow {
            computerWindow.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
            if let command, !command.isEmpty { computerCommandField?.stringValue = command; executeComputerCommand() }
            return
        }
        let root = NSStackView()
        root.orientation = .vertical; root.alignment = .leading; root.spacing = 14; root.edgeInsets = NSEdgeInsets(top: 28, left: 32, bottom: 28, right: 32); root.translatesAutoresizingMaskIntoConstraints = false
        let title = NSTextField(labelWithString: "Bilgisayar Yönetimi"); title.font = .systemFont(ofSize: 26, weight: .semibold)
        let detail = NSTextField(wrappingLabelWithString: "Komutlar önce onay ister. Tam erişim modu seçilirse onay penceresi atlanır; macOS Erişilebilirlik ve Tam Disk Erişimi izinleri yine Sistem Ayarları'ndan verilir."); detail.textColor = .secondaryLabelColor
        root.addArrangedSubview(title); root.addArrangedSubview(detail); root.addArrangedSubview(separatorBox())
        let trusted = AXIsProcessTrusted(); let permission = NSTextField(labelWithString: trusted ? "✓ Erişilebilirlik izni açık" : "⚠ Erişilebilirlik izni gerekli"); permission.textColor = trusted ? .systemGreen : .systemOrange
        root.addArrangedSubview(permission)
        if !trusted { root.addArrangedSubview(button("Erişilebilirlik Ayarlarını Aç") { [weak self] in self?.openAccessibilitySettings() }) }
        root.addArrangedSubview(button("Tam Disk Erişimi Ayarlarını Aç") { [weak self] in self?.openFullDiskAccessSettings() })
        let accessMode = NSButton(checkboxWithTitle: "Tam erişim modu (işlemleri otomatik yürüt)", target: self, action: #selector(toggleFullAccess))
        accessMode.state = fullAccessMode ? .on : .off
        root.addArrangedSubview(accessMode)
        root.addArrangedSubview(separatorBox()); root.addArrangedSubview(sectionLabel("Güvenli hızlı işlemler"))
        root.addArrangedSubview(button("Finder'ı Aç") { NSWorkspace.shared.open(URL(fileURLWithPath: "/System/Library/CoreServices/Finder.app")) })
        root.addArrangedSubview(button("Terminal'i Aç") { NSWorkspace.shared.open(URL(fileURLWithPath: "/System/Applications/Utilities/Terminal.app")) })
        root.addArrangedSubview(button("İndirilenler Klasörünü Aç") { NSWorkspace.shared.open(FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]) })
        root.addArrangedSubview(button("Dosya Seç ve Finder'da Göster") { self.chooseAndRevealFile() })
        let commandField = NSTextField(string: command ?? ""); commandField.placeholderString = "Komut (örn. Finder'ı aç, Terminal'i aç veya zsh komutu)"; commandField.translatesAutoresizingMaskIntoConstraints = false; commandField.widthAnchor.constraint(greaterThanOrEqualToConstant: 560).isActive = true; computerCommandField = commandField
        root.addArrangedSubview(commandField)
        root.addArrangedSubview(button("Komutu Çalıştır") { [weak self] in self?.executeComputerCommand() })
        root.addArrangedSubview(button("Komutu Durdur") { [weak self] in self?.computerCommand?.cancel() })
        let output = NSTextField(wrappingLabelWithString: "Hazır"); output.textColor = .secondaryLabelColor; output.maximumNumberOfLines = 0; computerOutput = output
        root.addArrangedSubview(output)
        let controller = NSViewController(); controller.view = root
        let panel = NSWindow(contentViewController: controller); panel.title = "Bilgisayar Yönetimi"; panel.minSize = NSSize(width: 620, height: 520); panel.setFrame(NSRect(x: 220, y: 180, width: 720, height: 620), display: false); panel.isReleasedWhenClosed = false
        computerWindow = panel; panel.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
        if command != nil { executeComputerCommand() }
    }

    @objc private func toggleFullAccess(_ sender: NSButton) {
        fullAccessMode = sender.state == .on
        computerOutput?.stringValue = fullAccessMode ? "Tam erişim modu açık. macOS izinleri ayrıca etkin olmalıdır." : "Onay modu açık. Komutlar çalışmadan önce onay istenir."
    }

    @objc private func executeComputerCommand() {
        guard computerCommand == nil else { computerOutput?.stringValue = "Bir komut zaten çalışıyor. Bitmesini bekle veya Komutu Durdur'a bas."; return }
        guard let raw = computerCommandField?.stringValue.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { return }
        if !fullAccessMode {
            let alert = NSAlert(); alert.messageText = "Bilgisayar komutu çalıştırılsın mı?"; alert.informativeText = raw; alert.addButton(withTitle: "Çalıştır"); alert.addButton(withTitle: "İptal"); alert.alertStyle = .warning
            guard alert.runModal() == .alertFirstButtonReturn else { computerOutput?.stringValue = "Komut iptal edildi."; return }
        }
        runComputerCommand(raw)
    }

    private func runComputerCommand(_ raw: String) {
        let lower = raw.lowercased()
        if lower.contains("finder") && (lower.contains("aç") || lower.contains("ac") || lower.contains("open")) { NSWorkspace.shared.open(URL(fileURLWithPath: "/System/Library/CoreServices/Finder.app")); computerOutput?.stringValue = "Finder açıldı."; return }
        if lower.contains("terminal") && (lower.contains("aç") || lower.contains("ac") || lower.contains("open")) { NSWorkspace.shared.open(URL(fileURLWithPath: "/System/Applications/Utilities/Terminal.app")); computerOutput?.stringValue = "Terminal açıldı."; return }
        computerOutput?.stringValue = "Çalıştırılıyor…"
        let command = BoundedCommand { [weak self] output in
            DispatchQueue.main.async { self?.computerOutput?.stringValue = output; self?.computerCommand = nil }
        }
        computerCommand = command
        do { try command.start(raw, directory: FileManager.default.homeDirectoryForCurrentUser) }
        catch { computerCommand = nil; computerOutput?.stringValue = "Komut çalıştırılamadı: \(error.localizedDescription)" }
    }

    private func showCodexWindow() {
        if let codexWindow { codexWindow.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true); return }
        let root = NSView(); let toolbar = NSStackView(); toolbar.orientation = .horizontal; toolbar.spacing = 8; toolbar.edgeInsets = NSEdgeInsets(top: 10, left: 10, bottom: 10, right: 10); toolbar.translatesAutoresizingMaskIntoConstraints = false
        let path = NSTextField(string: ""); path.placeholderString = "Düzenlenecek yerel dosya"; path.translatesAutoresizingMaskIntoConstraints = false; path.widthAnchor.constraint(greaterThanOrEqualToConstant: 380).isActive = true; codePathField = path
        let command = NSTextField(string: "npm run build"); command.placeholderString = "Yerel komut"; command.translatesAutoresizingMaskIntoConstraints = false; command.widthAnchor.constraint(greaterThanOrEqualToConstant: 220).isActive = true; codeCommandField = command
        [button("Dosya Aç") { [weak self] in self?.openCodeFile() }, button("Kaydet") { [weak self] in self?.saveCodeFile() }, path, button("Komutu Çalıştır") { [weak self] in self?.runCodeCommand() }, button("Durdur") { [weak self] in self?.codeCommand?.cancel() }, command].forEach { toolbar.addArrangedSubview($0) }
        let aiBar = NSStackView(); aiBar.orientation = .horizontal; aiBar.spacing = 8; aiBar.translatesAutoresizingMaskIntoConstraints = false
        let instruction = NSTextField(string: ""); instruction.placeholderString = "Bu dosyada ne değişsin?"; instruction.translatesAutoresizingMaskIntoConstraints = false; instruction.setContentHuggingPriority(.defaultLow, for: .horizontal); codeInstructionField = instruction
        let aiButton = button("AI ile Düzenle") { [weak self] in self?.requestCodeEdit() }; codeEditButton = aiButton
        aiBar.addArrangedSubview(instruction); aiBar.addArrangedSubview(aiButton)
        let editor = NSTextView(); editor.isRichText = false; editor.font = .monospacedSystemFont(ofSize: 13, weight: .regular); editor.autoresizingMask = [.width, .height]; editor.textContainerInset = NSSize(width: 12, height: 12); codeEditor = editor
        let scroll = NSScrollView(); scroll.hasVerticalScroller = true; scroll.hasHorizontalScroller = true; scroll.documentView = editor; scroll.translatesAutoresizingMaskIntoConstraints = false
        let output = NSTextView(); output.isEditable = false; output.isRichText = false; output.font = .monospacedSystemFont(ofSize: 12, weight: .regular); output.backgroundColor = .textBackgroundColor; codeOutput = output
        let outputScroll = NSScrollView(); outputScroll.hasVerticalScroller = true; outputScroll.documentView = output; outputScroll.translatesAutoresizingMaskIntoConstraints = false
        let title = NSTextField(labelWithString: "Codex"); title.font = .systemFont(ofSize: 20, weight: .semibold); title.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(title); root.addSubview(toolbar); root.addSubview(aiBar); root.addSubview(scroll); root.addSubview(outputScroll)
        NSLayoutConstraint.activate([title.topAnchor.constraint(equalTo: root.topAnchor, constant: 14), title.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 14), toolbar.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 8), toolbar.leadingAnchor.constraint(equalTo: root.leadingAnchor), toolbar.trailingAnchor.constraint(equalTo: root.trailingAnchor), aiBar.topAnchor.constraint(equalTo: toolbar.bottomAnchor, constant: 4), aiBar.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 10), aiBar.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -10), scroll.topAnchor.constraint(equalTo: aiBar.bottomAnchor, constant: 8), scroll.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 10), scroll.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -10), scroll.bottomAnchor.constraint(equalTo: outputScroll.topAnchor, constant: -8), outputScroll.leadingAnchor.constraint(equalTo: scroll.leadingAnchor), outputScroll.trailingAnchor.constraint(equalTo: scroll.trailingAnchor), outputScroll.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -10), outputScroll.heightAnchor.constraint(equalToConstant: 150)])
        let controller = NSViewController(); controller.view = root
        let panel = NSWindow(contentViewController: controller); panel.title = "Codex"; panel.minSize = NSSize(width: 980, height: 680); panel.setFrame(NSRect(x: 160, y: 80, width: 1280, height: 860), display: false); panel.isReleasedWhenClosed = false
        codexWindow = panel; panel.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
    }

    private func openCodeFile() {
        let panel = NSOpenPanel(); panel.canChooseFiles = true; panel.canChooseDirectories = false; panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do { codeEditor?.string = try String(contentsOf: url, encoding: .utf8); codePathField?.stringValue = url.path; codeOutput?.string = "Açıldı: \(url.path)" } catch { codeOutput?.string = "Dosya okunamadı: \(error.localizedDescription)" }
    }

    private func saveCodeFile() {
        guard let path = codePathField?.stringValue, !path.isEmpty, let content = codeEditor?.string else { codeOutput?.string = "Önce bir dosya aç veya dosya yolunu yaz."; return }
        let alert = NSAlert()
        alert.messageText = "Dosya değiştirilsin mi?"
        alert.informativeText = path
        alert.addButton(withTitle: "Kaydet")
        alert.addButton(withTitle: "İptal")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        do { try content.write(toFile: path, atomically: true, encoding: .utf8); codeOutput?.string = "Kaydedildi: \(path)" } catch { codeOutput?.string = "Kaydedilemedi: \(error.localizedDescription)" }
    }

    private func requestCodeEdit() {
        guard let path = codePathField?.stringValue, !path.isEmpty,
              let source = codeEditor?.string, !source.isEmpty,
              let instruction = codeInstructionField?.stringValue.trimmingCharacters(in: .whitespacesAndNewlines),
              !instruction.isEmpty else {
            codeOutput?.string = "Önce bir dosya açıp yapılacak değişikliği yaz."
            return
        }
        guard let webView = primaryWebView else {
            codeOutput?.string = "AI bağlantısı hazır değil. Chloe sohbet penceresini açıp tekrar dene."
            return
        }
        let payload: [String: String] = [
            "filename": URL(fileURLWithPath: path).lastPathComponent,
            "instruction": instruction,
            "source": source,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else {
            codeOutput?.string = "Düzenleme isteği hazırlanamadı."
            return
        }
        codeEditButton?.isEnabled = false
        codeOutput?.string = "AI dosyayı inceliyor ve değişiklik öneriyor… Dosya kaydedilmedi."
        let script = """
          try {
            const settings = JSON.parse(localStorage.getItem('kisisel-ai-asistan:settings') || '{}');
            const connectionFields = ['provider', 'cloudProvider', 'apiKey', 'apiBaseUrl', 'cloudModel', 'customModel', 'ollamaUrl', 'ollamaModel'];
            const connectionId = (value) => JSON.stringify(connectionFields.map((field) => value[field]));
            const originalConnection = connectionId(settings);
            // Only the active connection crosses the bridge; unrelated saved
            // credentials must not be included in code editing requests.
            settings.savedCustomProviders = [];
            settings.builtinConnections = {};
            settings.selectedCustomProviderId = '';
            settings.jarvisSpeechApiKey = '';
            if (settings.provider === 'local') settings.apiKey = '';
            const response = await fetch('/api/codex', {
              method: 'POST',
              signal: AbortSignal.timeout(125000),
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...\(json), settings })
            });
            if (originalConnection !== connectionId(JSON.parse(localStorage.getItem('kisisel-ai-asistan:settings') || '{}'))) {
              return JSON.stringify({ ok: false, data: { error: 'AI bağlantısı istek sırasında değişti. Eski modelin yanıtı uygulanmadı; yeni bağlantıyla tekrar dene.' } });
            }
            return JSON.stringify({ ok: response.ok, data: await response.json() });
          } catch (error) {
            return JSON.stringify({ ok: false, data: { error: String(error) } });
          }
        """
        webView.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { [weak self] outcome in
            DispatchQueue.main.async {
                guard let self else { return }
                self.codeEditButton?.isEnabled = true
                if case .failure(let error) = outcome {
                    self.codeOutput?.string = "AI isteği başarısız: \(error.localizedDescription)"
                    return
                }
                guard case .success(let result) = outcome,
                      let responseText = result as? String,
                      let responseData = responseText.data(using: .utf8),
                      let response = try? JSONSerialization.jsonObject(with: responseData) as? [String: Any],
                      let data = response["data"] as? [String: Any] else {
                    self.codeOutput?.string = "AI yanıtı okunamadı; dosya değiştirilmedi."
                    return
                }
                guard response["ok"] as? Bool == true, let updatedSource = data["source"] as? String else {
                    self.codeOutput?.string = (data["error"] as? String) ?? "AI düzenlemesi başarısız; dosya değiştirilmedi."
                    return
                }
                guard self.codePathField?.stringValue == path, self.codeEditor?.string == source else {
                    self.codeOutput?.string = "AI yanıtı beklenirken dosya veya editör değişti. Mevcut düzenlemen korundu; güncel dosyayla tekrar dene."
                    return
                }
                self.codeEditor?.string = updatedSource
                self.codeInstructionField?.stringValue = ""
                self.codeOutput?.string = "AI değişikliği editöre uygulandı; dosya henüz kaydedilmedi. İncele ve Kaydet'e bas."
            }
        }
    }

    private func runCodeCommand() {
        guard codeCommand == nil else { codeOutput?.string = "Bir komut zaten çalışıyor. Bitmesini bekle veya Durdur'a bas."; return }
        guard let command = codeCommandField?.stringValue.trimmingCharacters(in: .whitespacesAndNewlines), !command.isEmpty else { return }
        var directory = FileManager.default.homeDirectoryForCurrentUser
        if let path = codePathField?.stringValue, !path.isEmpty {
            directory = URL(fileURLWithPath: path).deletingLastPathComponent()
        }
        let alert = NSAlert()
        alert.messageText = "Komut çalıştırılsın mı?"
        alert.informativeText = "\(command)\n\nKlasör: \(directory.path)"
        alert.addButton(withTitle: "Çalıştır")
        alert.addButton(withTitle: "İptal")
        alert.alertStyle = .warning
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        codeOutput?.string = "Komut çalıştırılıyor…"
        let task = BoundedCommand { [weak self] output in
            DispatchQueue.main.async { self?.codeOutput?.string = output; self?.codeCommand = nil }
        }
        codeCommand = task
        do { try task.start(command, directory: directory) }
        catch { codeCommand = nil; codeOutput?.string = "Komut çalıştırılamadı: \(error.localizedDescription)" }
    }
    private func openAccessibilitySettings() {
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!)
        computerOutput?.stringValue = "Erişilebilirlik ayarları açıldı. Chloe için izni etkinleştirip bu ekranı yeniden seç."
    }
    private func openSpeechRecognitionSettings() {
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition")!)
    }
    private func openMicrophoneSettings() {
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")!)
    }
    private func openFullDiskAccessSettings() {
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")!)
        computerOutput?.stringValue = "Tam Disk Erişimi ayarları açıldı. Chloe'yi etkinleştirin."
    }
    private func chooseAndRevealFile() {
        let panel = NSOpenPanel(); panel.canChooseFiles = true; panel.canChooseDirectories = false; panel.allowsMultipleSelection = false
        if panel.runModal() == .OK, let url = panel.url { NSWorkspace.shared.activateFileViewerSelecting([url]); statusLabel.stringValue = "Finder'da gösterildi: " + url.lastPathComponent }
    }
    private func makeWebView(_ url: URL) -> WKWebView {
        let configuration = WKWebViewConfiguration(); configuration.websiteDataStore = .default()
        if url.host == "127.0.0.1" && url.port == 3004 { configuration.mediaTypesRequiringUserActionForPlayback = [] }
        let bridge = NativeBridgeHandler(owner: self)
        configuration.userContentController.add(bridge, name: "chloeMac")
        bridgeHandlers.append(bridge)
        let request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        let web = WKWebView(frame: .zero, configuration: configuration); web.translatesAutoresizingMaskIntoConstraints = false; web.navigationDelegate = self; web.uiDelegate = self; web.allowsBackForwardNavigationGestures = true; web.load(request); return web
    }

    // WKWebView otherwise silently returns false/nil for confirm/prompt,
    // breaking Codex file creation, test approval, and unsaved-edit protection.
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (Bool) -> Void) {
        guard frame.securityOrigin.host == "127.0.0.1", frame.securityOrigin.port == 3004 else { completionHandler(false); return }
        let alert = NSAlert(); alert.messageText = "Chloe · Onay"; alert.informativeText = String(message.prefix(4000))
        alert.addButton(withTitle: "Devam et"); alert.addButton(withTitle: "İptal")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (String?) -> Void) {
        guard frame.securityOrigin.host == "127.0.0.1", frame.securityOrigin.port == 3004 else { completionHandler(nil); return }
        let alert = NSAlert(); alert.messageText = "Chloe"; alert.informativeText = String(prompt.prefix(4000))
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 360, height: 24)); field.stringValue = defaultText ?? ""
        alert.accessoryView = field; alert.addButton(withTitle: "Tamam"); alert.addButton(withTitle: "İptal")
        alert.window.initialFirstResponder = field
        completionHandler(alert.runModal() == .alertFirstButtonReturn ? field.stringValue : nil)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil, let url = navigationAction.request.url,
           ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.user == nil, url.password == nil {
            // OAuth must start and finish in the same external browser so its
            // state cookie is retained and Google does not reject embedded login.
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor ([URL]?) -> Void) {
        guard frame.securityOrigin.host == "127.0.0.1", frame.securityOrigin.port == 3004 else { completionHandler(nil); return }
        let panel = NSOpenPanel(); panel.canChooseFiles = true; panel.canChooseDirectories = false
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        completionHandler(panel.runModal() == .OK ? panel.urls : nil)
    }
    private func button(_ title: String, action: @escaping () -> Void) -> NSButton {
        let button = ClosureButton(title: title, action: action)
        button.bezelStyle = .rounded
        return button
    }
    private func sectionLabel(_ text: String) -> NSTextField { let label = NSTextField(labelWithString: text); label.font = .systemFont(ofSize: 14, weight: .semibold); return label }
    private func separatorBox() -> NSBox { let box = NSBox(); box.boxType = .separator; return box }
    private func pin(_ view: NSView, to parent: NSView) { view.translatesAutoresizingMaskIntoConstraints = false; [view.topAnchor.constraint(equalTo: parent.topAnchor), view.leadingAnchor.constraint(equalTo: parent.leadingAnchor), view.trailingAnchor.constraint(equalTo: parent.trailingAnchor), view.bottomAnchor.constraint(equalTo: parent.bottomAnchor)].forEach { $0.isActive = true } }
}

private final class NativeBridgeHandler: NSObject, WKScriptMessageHandler {
    weak var owner: ChloeDesktopApp?
    init(owner: ChloeDesktopApp) { self.owner = owner }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              let origin = message.frameInfo.request.url,
              origin.scheme == "http",
              origin.host == "127.0.0.1",
              origin.port == 3004 else { return }
        guard message.name == "chloeMac", let payload = message.body as? [String: Any], let action = payload["action"] as? String else { return }
        let url = payload["url"] as? String
        let command = payload["command"] as? String
        let speechId = payload["speechId"] as? String ?? ""
        let rate = payload["rate"] as? Double ?? 0.96
        let pitch = payload["pitch"] as? Double ?? 1
        let silenceMs = payload["silenceMs"] as? Double
        let autoSend = payload["autoSend"] as? Bool ?? true
        DispatchQueue.main.async { [weak self] in
            self?.owner?.handleNativeAction(action, url: url, command: command, speechId: speechId, rate: rate, pitch: pitch, silenceMs: silenceMs, autoSend: autoSend)
        }
    }
}

@main
@MainActor
struct ChloeDesktopMain {
    static func main() {
        let application = NSApplication.shared
        let delegate = ChloeDesktopApp()
        application.delegate = delegate
        application.setActivationPolicy(.regular)
        withExtendedLifetime(delegate) {
            application.run()
        }
    }
}

private final class ClosureButton: NSButton {
    let handler: () -> Void
    init(title: String, action: @escaping () -> Void) {
        self.handler = action
        super.init(frame: .zero)
        self.title = title
        target = self
        self.action = #selector(invoke)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    @objc private func invoke() { handler() }
}
