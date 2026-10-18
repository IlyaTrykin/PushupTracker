package app.pushuptracker.mobile.plugins.repcounter

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorManager
import android.net.Uri
import android.provider.Settings
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

/**
 * Counting reps with the phone's sensors (interfaces.md §7): a full-screen native screen
 * ([RepCounterActivity]) with the camera (pose — ML Kit, bundled model) or a dark screen for the
 * proximity sensor («touch with the chest»).
 * JS (`src/lib/rep-counter.ts`):
 * `isAvailable({mode}) → {available, reason?: 'no_camera'|'no_sensor'|'unsupported_os'}`,
 * `start({mode, exerciseType, locale}) → {reps, durationSeconds, cancelled}` — rejects with code
 * `permission_denied` when the camera is not allowed, `no_sensor` without a proximity sensor;
 * `openSettings()` — the app's page in the system settings.
 * Without a camera `start` still opens the screen, which says so.
 */
@CapacitorPlugin(
    name = "RepCounter",
    permissions = [Permission(strings = [Manifest.permission.CAMERA], alias = RepCounterPlugin.CAMERA)],
)
class RepCounterPlugin : Plugin() {
    companion object {
        const val CAMERA = "camera"

        fun hasProximitySensor(context: Context): Boolean {
            val sensors = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager ?: return false
            return sensors.getDefaultSensor(Sensor.TYPE_PROXIMITY) != null
        }

        fun hasCamera(context: Context): Boolean =
            context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
    }

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        val result = JSObject()
        if (call.getString("mode") == "proximity") {
            val available = hasProximitySensor(context)
            result.put("available", available)
            if (!available) result.put("reason", "no_sensor")
        } else {
            val available = hasCamera(context)
            result.put("available", available)
            if (!available) result.put("reason", "no_camera")
        }
        call.resolve(result)
    }

    @PluginMethod
    fun start(call: PluginCall) {
        val exercise = RepExercise.fromId(call.getString("exerciseType"))
        if (exercise == null) {
            call.reject("Unsupported exercise", "invalid_argument")
            return
        }
        if (call.getString("mode") == "proximity") {
            if (exercise != RepExercise.PUSHUPS) {
                call.reject("Touch counting is for push-ups only", "invalid_argument")
                return
            }
            if (!hasProximitySensor(context)) {
                call.reject("No proximity sensor", "no_sensor")
                return
            }
            launch(call, RepCounterActivity.MODE_PROXIMITY)
            return
        }
        if (!hasCamera(context)) {
            launch(call, RepCounterActivity.MODE_NO_CAMERA)
            return
        }
        if (getPermissionState(CAMERA) == PermissionState.GRANTED) {
            launch(call, RepCounterActivity.MODE_CAMERA)
        } else {
            requestPermissionForAlias(CAMERA, call, "cameraPermissionResult")
        }
    }

    @PermissionCallback
    private fun cameraPermissionResult(call: PluginCall) {
        if (getPermissionState(CAMERA) == PermissionState.GRANTED) {
            launch(call, RepCounterActivity.MODE_CAMERA)
        } else {
            call.reject("Camera access denied", "permission_denied")
        }
    }

    private fun launch(call: PluginCall, mode: String) {
        val intent = Intent(context, RepCounterActivity::class.java)
            .putExtra(RepCounterActivity.EXTRA_MODE, mode)
            .putExtra(RepCounterActivity.EXTRA_EXERCISE, call.getString("exerciseType"))
            .putExtra(RepCounterActivity.EXTRA_LOCALE, if (call.getString("locale") == "en") "en" else "ru")
        startActivityForResult(call, intent, "counterResult")
    }

    @ActivityCallback
    private fun counterResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val data = result.data
        val done = result.resultCode == Activity.RESULT_OK && data != null &&
            !data.getBooleanExtra(RepCounterActivity.RESULT_CANCELLED, true)
        val answer = JSObject()
        answer.put("reps", if (done) data!!.getIntExtra(RepCounterActivity.RESULT_REPS, 0) else 0)
        answer.put("durationSeconds", data?.getIntExtra(RepCounterActivity.RESULT_DURATION, 0) ?: 0)
        answer.put("cancelled", !done)
        call.resolve(answer)
    }

    @PluginMethod
    fun openSettings(call: PluginCall) {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        call.resolve()
    }
}
