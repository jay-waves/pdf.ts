import Foundation
import ServiceManagement
import Darwin

// This is the app's main executable so ServiceManagement resolves the enclosing
// app bundle, even when invoked from Terminal rather than Launch Services.
let arguments = Array(CommandLine.arguments.dropFirst())
let service = SMAppService.agent(plistName: "io.github.jay-waves.pdf.ts.agent.plist")

func printStatus() {
    switch service.status {
    case .enabled: print("enabled")
    case .notRegistered: print("disabled")
    case .requiresApproval: print("requires-approval")
    case .notFound: print("not-found")
    @unknown default: print("unknown")
    }
}

do {
    if arguments.first == "autostart" {
        guard arguments.count == 2 else {
            throw NSError(domain: "pdf.ts", code: 1, userInfo: [NSLocalizedDescriptionKey:
                "Usage: pdf.ts autostart <enable|disable|status>"])
        }
        switch arguments[1] {
        case "enable":
            if service.status == .notRegistered || service.status == .notFound {
                try service.register()
            }
            if service.status == .requiresApproval {
                SMAppService.openSystemSettingsLoginItems()
                print("Approve pdf.ts in System Settings > General > Login Items.")
            }
            printStatus()
        case "disable":
            if service.status == .enabled || service.status == .requiresApproval {
                try service.unregister()
            }
            printStatus()
        case "status": printStatus()
        default:
            throw NSError(domain: "pdf.ts", code: 1, userInfo: [NSLocalizedDescriptionKey:
                "Usage: pdf.ts autostart <enable|disable|status>"])
        }
    } else {
        let launcher = Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/pdf-ts-launcher")
        // Replace the wrapper rather than leaving a parent process behind.
        let strings = [launcher.path] + arguments
        let pointers = strings.map { strdup($0) } + [nil]
        defer { pointers.forEach { free($0) } }
        pointers.withUnsafeBufferPointer { buffer in
            _ = execv(launcher.path, buffer.baseAddress!)
        }
        throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
    }
} catch {
    let failure = error as NSError
    FileHandle.standardError.write(Data("pdf.ts: \(failure.localizedDescription) [\(failure.domain):\(failure.code)]\n".utf8))
    exit(1)
}
