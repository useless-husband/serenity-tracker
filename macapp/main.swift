import Cocoa
import WebKit

let PORT = 8795

// 找專案資料夾：App 旁邊、桌面、家目錄都找找看
func projectDir() -> String {
    let appDir = (Bundle.main.bundlePath as NSString).deletingLastPathComponent
    let home = NSHomeDirectory()
    for cand in [appDir, appDir + "/SerenityTracker", home + "/Desktop/SerenityTracker", home + "/SerenityTracker"] {
        if FileManager.default.fileExists(atPath: cand + "/app_server.py") { return cand }
    }
    return home + "/Desktop/SerenityTracker"
}

func findPython() -> String? {
    let cands = ["/Library/Frameworks/Python.framework/Versions/Current/bin/python3",
                 "/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/usr/bin/python3"]
    return cands.first { FileManager.default.isExecutableFile(atPath: $0) }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var status: NSTextField!
    var server: Process?

    func applicationDidFinishLaunching(_ n: Notification) {
        buildMenu()
        let rect = NSRect(x: 0, y: 0, width: 1180, height: 820)
        window = NSWindow(contentRect: rect, styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "Serenity 追蹤"
        window.minSize = NSSize(width: 760, height: 520)
        window.center()
        window.setFrameAutosaveName("main")

        let cfg = WKWebViewConfiguration()
        cfg.preferences.setValue(true, forKey: "developerExtrasEnabled")
        web = WKWebView(frame: rect, configuration: cfg)
        web.autoresizingMask = [.width, .height]
        web.uiDelegate = self
        web.navigationDelegate = self

        status = NSTextField(labelWithString: "正在啟動…")
        status.font = NSFont.systemFont(ofSize: 16)
        status.textColor = .secondaryLabelColor
        status.alignment = .center
        status.frame = NSRect(x: 0, y: rect.height / 2 - 20, width: rect.width, height: 40)
        status.autoresizingMask = [.width, .minYMargin, .maxYMargin]
        window.contentView?.addSubview(status)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        ping { ok in ok ? self.showApp() : self.launchServer() }
    }

    func ping(_ done: @escaping (Bool) -> Void) {
        let url = URL(string: "http://127.0.0.1:\(PORT)/api/health")!
        var req = URLRequest(url: url)
        req.timeoutInterval = 2
        URLSession.shared.dataTask(with: req) { _, resp, _ in
            let ok = (resp as? HTTPURLResponse)?.statusCode == 200
            DispatchQueue.main.async { done(ok) }
        }.resume()
    }

    func launchServer() {
        let dir = projectDir()
        guard let py = findPython() else {
            status.stringValue = "找不到 python3，請先安裝 Python 3"
            return
        }
        let p = Process()
        p.currentDirectoryURL = URL(fileURLWithPath: dir)
        p.executableURL = URL(fileURLWithPath: py)
        p.arguments = ["app_server.py", String(PORT)]
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = NSHomeDirectory() + "/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        p.environment = env
        try? FileManager.default.createDirectory(atPath: dir + "/live", withIntermediateDirectories: true)
        FileManager.default.createFile(atPath: dir + "/live/app.log", contents: nil)
        let log = FileHandle(forWritingAtPath: dir + "/live/app.log") ?? FileHandle.nullDevice
        p.standardOutput = log
        p.standardError = log
        do { try p.run(); server = p } catch {
            status.stringValue = "啟動失敗：\(error.localizedDescription)"
            return
        }
        status.stringValue = "正在載入推文…"
        waitForServer(tries: 0)
    }

    func waitForServer(tries: Int) {
        if tries > 60 {
            status.stringValue = "程式沒有回應，請看 \(projectDir())/live/app.log"
            return
        }
        ping { ok in
            if ok { self.showApp() } else {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.waitForServer(tries: tries + 1) }
            }
        }
    }

    func showApp() {
        status.removeFromSuperview()
        window.contentView?.addSubview(web)
        web.frame = window.contentView!.bounds
        web.load(URLRequest(url: URL(string: "http://127.0.0.1:\(PORT)/")!))
    }

    // 外部連結（X、新聞）用預設瀏覽器開
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = action.request.url, url.host != "127.0.0.1", url.scheme?.hasPrefix("http") == true {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { NSWorkspace.shared.open(url) }
        return nil
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert(); a.messageText = message; a.runModal(); completionHandler()
    }

    @objc func reload() { web.reload() }

    func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem(); main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "結束 Serenity 追蹤", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let editItem = NSMenuItem(); main.addItem(editItem)
        let edit = NSMenu(title: "編輯")
        edit.addItem(withTitle: "還原", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "重做", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "剪下", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "拷貝", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "貼上", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "全選", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit

        let viewItem = NSMenuItem(); main.addItem(viewItem)
        let view = NSMenu(title: "顯示")
        view.addItem(withTitle: "重新整理", action: #selector(reload), keyEquivalent: "r")
        viewItem.submenu = view

        let winItem = NSMenuItem(); main.addItem(winItem)
        let win = NSMenu(title: "視窗")
        win.addItem(withTitle: "縮到最小", action: #selector(NSWindow.miniaturize(_:)), keyEquivalent: "m")
        win.addItem(withTitle: "關閉", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        winItem.submenu = win
        NSApp.mainMenu = main
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ s: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ n: Notification) {
        if let p = server, p.isRunning { p.terminate() }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
