import AVFoundation
import Capacitor
import Foundation
import UIKit

/// Counting reps with the phone's sensors (interfaces.md §7): a full-screen native screen with the
/// camera (pose — Vision) or a dark screen for the proximity sensor («touch with the chest»).
/// JS (`src/lib/rep-counter.ts`):
/// `isAvailable({mode}) → {available, reason?: 'no_camera'|'no_sensor'|'unsupported_os'}`,
/// `start({mode, exerciseType, locale}) → {reps, durationSeconds, cancelled}` — rejects with code
/// `permission_denied` when the camera is not allowed, `no_sensor` without a proximity sensor,
/// `busy` when the screen is already open; `openSettings()` — the app's page in Settings.
/// Without a camera (the simulator) `start` still opens the screen, which says so.
@objc(RepCounterPlugin)
public class RepCounterPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RepCounterPlugin"
    public let jsName = "RepCounter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise)
    ]

    private var screen: RepCounterViewController?

    /// Enabling proximity monitoring silently stays off on devices without the sensor.
    static func hasProximitySensor() -> Bool {
        let device = UIDevice.current
        let wasEnabled = device.isProximityMonitoringEnabled
        device.isProximityMonitoringEnabled = true
        let available = device.isProximityMonitoringEnabled
        device.isProximityMonitoringEnabled = wasEnabled
        return available
    }

    @objc func isAvailable(_ call: CAPPluginCall) {
        let mode = call.getString("mode") ?? "camera"
        DispatchQueue.main.async {
            if mode == "proximity" {
                call.resolve(Self.hasProximitySensor() ? ["available": true] : ["available": false, "reason": "no_sensor"])
            } else {
                call.resolve(RepCounterViewController.captureDevice() != nil ? ["available": true] : ["available": false, "reason": "no_camera"])
            }
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        guard let exercise = RepExercise(rawValue: call.getString("exerciseType") ?? "") else {
            call.reject("Unsupported exercise", "invalid_argument")
            return
        }
        let proximity = call.getString("mode") == "proximity"
        let locale = call.getString("locale") == "en" ? "en" : "ru"
        if proximity && exercise != .pushups {
            call.reject("Touch counting is for push-ups only", "invalid_argument")
            return
        }
        DispatchQueue.main.async {
            if self.screen != nil {
                call.reject("The counter is already open", "busy")
                return
            }
            if proximity {
                guard Self.hasProximitySensor() else {
                    call.reject("No proximity sensor", "no_sensor")
                    return
                }
                self.present(call, mode: .proximity, exercise: exercise, locale: locale)
                return
            }
            guard RepCounterViewController.captureDevice() != nil else {
                // No camera (the iOS simulator): the screen opens and explains it.
                self.present(call, mode: .noCamera, exercise: exercise, locale: locale)
                return
            }
            switch AVCaptureDevice.authorizationStatus(for: .video) {
            case .authorized:
                self.present(call, mode: .camera, exercise: exercise, locale: locale)
            case .notDetermined:
                AVCaptureDevice.requestAccess(for: .video) { granted in
                    DispatchQueue.main.async {
                        if granted {
                            self.present(call, mode: .camera, exercise: exercise, locale: locale)
                        } else {
                            call.reject("Camera access denied", "permission_denied")
                        }
                    }
                }
            default:
                call.reject("Camera access denied", "permission_denied")
            }
        }
    }

    private func present(_ call: CAPPluginCall, mode: RepCounterViewController.Mode, exercise: RepExercise, locale: String) {
        guard let host = bridge?.viewController else {
            call.reject("No view controller to present from", "unavailable")
            return
        }
        let controller = RepCounterViewController(mode: mode, exercise: exercise, locale: locale) { [weak self] reps, duration, cancelled in
            self?.screen = nil
            call.resolve(["reps": reps, "durationSeconds": duration, "cancelled": cancelled])
        }
        screen = controller
        host.present(controller, animated: true)
    }

    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let url = URL(string: UIApplication.openSettingsURLString) {
                UIApplication.shared.open(url)
            }
            call.resolve()
        }
    }
}
