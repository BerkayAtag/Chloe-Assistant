import Foundation
import Darwin

/// One user-approved command, with bounded output and an explicit stop path.
final class BoundedCommand: @unchecked Sendable {
    private let task = Process()
    private let pipe = Pipe()
    private let lock = NSLock()
    private var bytes = Data()
    private var finished = false
    private var reason = ""
    private var group: pid_t?
    private let completion: @Sendable (String) -> Void
    private let limit = 128_000

    init(completion: @escaping @Sendable (String) -> Void) { self.completion = completion }

    func start(_ command: String, directory: URL, timeout: Double = 60) throws {
        task.executableURL = URL(fileURLWithPath: "/bin/zsh")
        task.arguments = ["-lc", command]
        task.currentDirectoryURL = directory
        task.standardInput = FileHandle.nullDevice
        task.standardOutput = pipe; task.standardError = pipe
        let fd = pipe.fileHandleForReading.fileDescriptor
        _ = fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK)
        pipe.fileHandleForReading.readabilityHandler = { [weak self] _ in self?.drain() }
        task.terminationHandler = { [weak self] process in self?.finish("Çıkış kodu: \(process.terminationStatus)") }
        do { try task.run() }
        catch { pipe.fileHandleForReading.readabilityHandler = nil; throw error }
        if getpgid(task.processIdentifier) == task.processIdentifier { group = task.processIdentifier }
        DispatchQueue.global().asyncAfter(deadline: .now() + timeout) { [weak self] in
            self?.cancel("Komut \(Int(timeout)) saniye sınırında durduruldu.")
        }
    }

    func cancel(_ message: String = "Komut kullanıcı tarafından durduruldu.") {
        lock.lock()
        guard !finished, reason.isEmpty else { lock.unlock(); return }
        reason = message
        lock.unlock()
        if let group { _ = kill(-group, SIGTERM) } else if task.isRunning { task.terminate() }
        // A command ignoring TERM must not leave the UI or its process group stuck.
        DispatchQueue.global().asyncAfter(deadline: .now() + 2) { [self] in
            if let group { _ = kill(-group, SIGKILL) }
            else if task.isRunning { _ = kill(task.processIdentifier, SIGKILL) }
            finish(message)
        }
    }

    private func drain() {
        lock.lock()
        guard !finished else { lock.unlock(); return }
        var chunk = [UInt8](repeating: 0, count: 8192)
        var truncated = false
        while true {
            let count = Darwin.read(pipe.fileHandleForReading.fileDescriptor, &chunk, chunk.count)
            if count <= 0 { break }
            let remaining = max(0, limit - bytes.count)
            bytes.append(contentsOf: chunk.prefix(min(remaining, count)))
            if count > remaining { truncated = true; break }
        }
        lock.unlock()
        if truncated { cancel("Çıktı 128 KB sınırını aştığı için komut durduruldu.") }
    }

    private func finish(_ summary: String) {
        drain()
        lock.lock()
        guard !finished else { lock.unlock(); return }
        finished = true
        let output = String(decoding: bytes, as: UTF8.self)
        let result = "\(reason.isEmpty ? summary : reason)\n\n\(output)"
        lock.unlock()
        pipe.fileHandleForReading.readabilityHandler = nil
        try? pipe.fileHandleForReading.close()
        completion(result)
    }
}
