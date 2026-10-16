import Foundation

final class CommandTestResult: @unchecked Sendable {
    let ready = DispatchSemaphore(value: 0)
    private let lock = NSLock()
    private var text = ""
    func receive(_ value: String) { lock.lock(); text = value; lock.unlock(); ready.signal() }
    func output() -> String { lock.lock(); defer { lock.unlock() }; return text }
}

@main
struct NativeCommandTests {
    static func main() throws {
        for (name, script, expected, timeout, cancel) in [
            ("normal output", "printf CHLOE_NATIVE_OK", "CHLOE_NATIVE_OK", 5.0, false),
            ("output limit", "yes CHLOE_LIMIT", "128 KB", 5.0, false),
            ("timeout", "sleep 30", "saniye sınırında", 0.5, false),
            ("cancellation", "trap '' TERM; sleep 30", "kullanıcı tarafından", 5.0, true),
        ] {
            let result = CommandTestResult()
            let command = BoundedCommand { result.receive($0) }
            try command.start(script, directory: FileManager.default.temporaryDirectory, timeout: timeout)
            if cancel { command.cancel() }
            guard result.ready.wait(timeout: .now() + 8) == .success else { fatalError("Timeout: \(name)") }
            guard result.output().contains(expected), result.output().utf8.count < 130_000 else { fatalError("Failed: \(name)") }
            print("PASS native \(name)")
        }
    }
}
