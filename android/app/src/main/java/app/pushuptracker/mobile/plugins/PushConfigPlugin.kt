package app.pushuptracker.mobile.plugins

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Есть ли в этой сборке конфиг Firebase. Плагин google-services создаёт ресурс `google_app_id`
 * только из `google-services.json` (build.gradle подключает его лишь при наличии файла), а без
 * этого ресурса FirebaseApp не инициализируется и `PushNotifications.register()` роняет приложение.
 * JS спрашивает это до регистрации пушей: `status() → {firebaseConfigured}`.
 */
@CapacitorPlugin(name = "PushConfig")
class PushConfigPlugin : Plugin() {
    @PluginMethod
    fun status(call: PluginCall) {
        val resId = context.resources.getIdentifier("google_app_id", "string", context.packageName)
        val configured = resId != 0 && context.getString(resId).isNotBlank()
        call.resolve(JSObject().put("firebaseConfigured", configured))
    }
}
