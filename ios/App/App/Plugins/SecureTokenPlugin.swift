import Foundation
import Capacitor
import Security

/// Токен сессии приложения — только здесь: Keychain, доступ после первой разблокировки,
/// без переноса на другое устройство через резервную копию.
/// JS: `SecureToken.get() → {value}`, `set({value})`, `remove()`.
@objc(SecureTokenPlugin)
public class SecureTokenPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SecureTokenPlugin"
    public let jsName = "SecureToken"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise)
    ]

    private let service = "app.pushuptracker.mobile.session"
    private let account = "session_token"
    private let installedFlag = "secureTokenInstalled"

    override public func load() {
        // Keychain переживает удаление приложения: после переустановки старый вход не подхватывается.
        let defaults = UserDefaults.standard
        if !defaults.bool(forKey: installedFlag) {
            SecItemDelete(baseQuery() as CFDictionary)
            defaults.set(true, forKey: installedFlag)
        }
    }

    private func baseQuery() -> [String: Any] {
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }

    @objc func get(_ call: CAPPluginCall) {
        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound {
            call.resolve(["value": NSNull()])
            return
        }
        guard status == errSecSuccess, let data = item as? Data, let value = String(data: data, encoding: .utf8) else {
            call.reject("Secure storage is unavailable", "storage_unavailable")
            return
        }
        call.resolve(["value": value])
    }

    @objc func set(_ call: CAPPluginCall) {
        guard let value = call.getString("value"), !value.isEmpty, let data = value.data(using: .utf8) else {
            call.reject("value is required", "invalid_value")
            return
        }
        SecItemDelete(baseQuery() as CFDictionary)
        var attributes = baseQuery()
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(attributes as CFDictionary, nil)
        guard status == errSecSuccess else {
            call.reject("Could not save the token", "storage_write_failed")
            return
        }
        call.resolve()
    }

    @objc func remove(_ call: CAPPluginCall) {
        let status = SecItemDelete(baseQuery() as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            call.reject("Secure storage is unavailable", "storage_unavailable")
            return
        }
        call.resolve()
    }
}
