import Foundation
import Capacitor

/// Фоновая отправка записей офлайн-очереди (см. `BackgroundUploadManager`).
/// JS: `BackgroundUpload.enqueue({id, url, headers, body, delaySeconds?}) → {queued}`,
/// `cancel({id}) → {cancelled}`, `list() → {items: [{id, state, httpStatus?}]}`.
@objc(BackgroundUploadPlugin)
public class BackgroundUploadPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BackgroundUploadPlugin"
    public let jsName = "BackgroundUpload"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "enqueue", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise)
    ]

    private let manager = BackgroundUploadManager.shared

    override public func load() {
        manager.activate()
    }

    @objc func enqueue(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), !id.isEmpty,
              let rawUrl = call.getString("url"), let url = URL(string: rawUrl),
              url.scheme == "https" || url.scheme == "http",
              let body = call.getString("body"), let data = body.data(using: .utf8) else {
            call.reject("id, url and body are required", "invalid_request")
            return
        }
        var headers: [String: String] = [:]
        for (name, value) in call.getObject("headers") ?? [:] {
            if let text = value as? String { headers[name] = text }
        }
        let delay = max(0, call.getDouble("delaySeconds") ?? 0)
        manager.enqueue(id: id, url: url, headers: headers, body: data, delaySeconds: delay) { queued in
            call.resolve(["queued": queued])
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), !id.isEmpty else {
            call.reject("id is required", "invalid_request")
            return
        }
        manager.cancel(id: id) { cancelled in
            call.resolve(["cancelled": cancelled])
        }
    }

    @objc func list(_ call: CAPPluginCall) {
        manager.list { items in
            call.resolve(["items": items])
        }
    }
}
