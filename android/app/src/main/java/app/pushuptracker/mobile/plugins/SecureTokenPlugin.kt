package app.pushuptracker.mobile.plugins

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Токен сессии приложения — только здесь: EncryptedSharedPreferences, ключ шифрования в
 * Android Keystore. JS: `SecureToken.get() → {value}`, `set({value})`, `remove()`.
 */
@CapacitorPlugin(name = "SecureToken")
class SecureTokenPlugin : Plugin() {
    private var prefs: SharedPreferences? = null

    private fun storage(): SharedPreferences {
        prefs?.let { return it }
        val appContext = context.applicationContext
        val created = try {
            open(appContext)
        } catch (error: Exception) {
            // Ключ в Keystore испорчен (восстановление из бэкапа на другом устройстве и т. п.):
            // старый файл не расшифровать — начинаем с чистого, пользователь войдёт заново.
            appContext.deleteSharedPreferences(FILE_NAME)
            open(appContext)
        }
        prefs = created
        return created
    }

    private fun open(appContext: Context): SharedPreferences {
        val masterKey = MasterKey.Builder(appContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return EncryptedSharedPreferences.create(
            appContext,
            FILE_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    @PluginMethod
    fun get(call: PluginCall) {
        try {
            val result = JSObject()
            val value = storage().getString(KEY_TOKEN, null)
            if (value == null) result.put("value", JSObject.NULL) else result.put("value", value)
            call.resolve(result)
        } catch (error: Exception) {
            call.reject("Secure storage is unavailable", "storage_unavailable", error)
        }
    }

    @PluginMethod
    fun set(call: PluginCall) {
        val value = call.getString("value")
        if (value.isNullOrEmpty()) {
            call.reject("value is required", "invalid_value")
            return
        }
        try {
            if (!storage().edit().putString(KEY_TOKEN, value).commit()) {
                call.reject("Could not save the token", "storage_write_failed")
                return
            }
            call.resolve()
        } catch (error: Exception) {
            call.reject("Secure storage is unavailable", "storage_unavailable", error)
        }
    }

    @PluginMethod
    fun remove(call: PluginCall) {
        try {
            storage().edit().remove(KEY_TOKEN).commit()
            call.resolve()
        } catch (error: Exception) {
            call.reject("Secure storage is unavailable", "storage_unavailable", error)
        }
    }

    private companion object {
        const val FILE_NAME = "pushup_secure_token"
        const val KEY_TOKEN = "session_token"
    }
}
