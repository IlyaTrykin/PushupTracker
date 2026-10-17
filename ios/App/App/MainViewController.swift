import UIKit
import Capacitor

/// Мост Capacitor с локальными плагинами приложения (ios/App/App/Plugins).
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(SecureTokenPlugin())
    }
}
