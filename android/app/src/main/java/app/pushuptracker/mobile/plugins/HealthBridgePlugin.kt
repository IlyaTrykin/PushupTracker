package app.pushuptracker.mobile.plugins

import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.metadata.DataOrigin
import androidx.health.connect.client.records.metadata.Device
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.health.connect.client.units.Length
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.time.Instant
import java.time.ZoneId
import kotlin.coroutines.Continuation
import kotlin.coroutines.EmptyCoroutineContext
import kotlin.coroutines.startCoroutine
import kotlin.reflect.KClass

/**
 * Health Connect: workouts of the tracker as `ExerciseSessionRecord` (+ `DistanceRecord` for
 * run / bike / row). `clientRecordId` = the workout's key (`externalId`, distance — `<key>:distance`),
 * `clientRecordVersion` = its fingerprint (8 hex digits as a number). Only the app's own records
 * are read, rewritten and deleted.
 * JS (`src/lib/health/health.ts`): `isAvailable() → {available, reason?}`,
 * `requestPermissions() → {granted}`, `saveWorkout(HealthWorkoutInput) → {saved, skipped?}`,
 * `deleteWorkout({externalId}) → {deleted}`, `listOwn({since}) → {records: [{externalId, fingerprint}]}`,
 * `openSettings()`.
 */
@CapacitorPlugin(name = "HealthBridge")
class HealthBridgePlugin : Plugin() {
    companion object {
        private const val PROVIDER = "com.google.android.apps.healthdata"
        private const val DISTANCE_SUFFIX = ":distance"
        private const val PAGE_SIZE = 1000

        private val ACTIVITIES = mapOf(
            "EXERCISE_TYPE_RUNNING" to ExerciseSessionRecord.EXERCISE_TYPE_RUNNING,
            "EXERCISE_TYPE_BIKING" to ExerciseSessionRecord.EXERCISE_TYPE_BIKING,
            "EXERCISE_TYPE_ROWING_MACHINE" to ExerciseSessionRecord.EXERCISE_TYPE_ROWING_MACHINE,
            "EXERCISE_TYPE_CALISTHENICS" to ExerciseSessionRecord.EXERCISE_TYPE_CALISTHENICS,
            "EXERCISE_TYPE_OTHER_WORKOUT" to ExerciseSessionRecord.EXERCISE_TYPE_OTHER_WORKOUT,
            "EXERCISE_TYPE_STRENGTH_TRAINING" to ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING,
        )

        private val WRITE_SESSION = HealthPermission.getWritePermission(ExerciseSessionRecord::class)
        private val WRITE_DISTANCE = HealthPermission.getWritePermission(DistanceRecord::class)
        private val PERMISSIONS = setOf(
            WRITE_SESSION,
            WRITE_DISTANCE,
            HealthPermission.getReadPermission(ExerciseSessionRecord::class),
            HealthPermission.getReadPermission(DistanceRecord::class),
        )

        /** Fingerprint `a1b2c3d4` ⇄ `clientRecordVersion`. */
        fun fingerprintToVersion(fingerprint: String): Long? =
            if (Regex("^[0-9a-f]{1,15}$").matches(fingerprint)) fingerprint.toLong(16) else null

        fun versionToFingerprint(version: Long): String = String.format("%08x", version)
    }

    private fun client(): HealthConnectClient = HealthConnectClient.getOrCreate(context)

    private fun sdkStatus(): Int = HealthConnectClient.getSdkStatus(context, PROVIDER)

    private fun ownOrigin() = setOf(DataOrigin(context.packageName))

    /** Runs a suspending Health Connect call without kotlinx.coroutines (stdlib only). */
    private fun <T> launch(call: PluginCall, block: suspend () -> T, onResult: (T) -> Unit) {
        block.startCoroutine(Continuation(EmptyCoroutineContext) { result ->
            result.fold(
                onSuccess = { value ->
                    try {
                        onResult(value)
                    } catch (error: Exception) {
                        call.reject(error.message ?: "Health Connect error", "health_error", error)
                    }
                },
                onFailure = { error ->
                    val code = if (error is SecurityException) "not_authorized" else "health_error"
                    call.reject(error.message ?: "Health Connect error", code, error as? Exception)
                },
            )
        })
    }

    private fun providerInstalled(): Boolean =
        try {
            context.packageManager.getPackageInfo(PROVIDER, 0)
            true
        } catch (_: PackageManager.NameNotFoundException) {
            false
        }

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        val result = JSObject()
        when (sdkStatus()) {
            HealthConnectClient.SDK_AVAILABLE -> result.put("available", true)
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> {
                result.put("available", false)
                // Android 14+ has Health Connect in the system; before that it is an app from Google Play.
                val missing = Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE && !providerInstalled()
                result.put("reason", if (missing) "not_installed" else "update_required")
            }
            else -> {
                result.put("available", false)
                result.put("reason", "not_supported")
            }
        }
        call.resolve(result)
    }

    @PluginMethod
    override fun requestPermissions(call: PluginCall) {
        if (sdkStatus() != HealthConnectClient.SDK_AVAILABLE) {
            call.resolve(JSObject().put("granted", false))
            return
        }
        launch(call, { client().permissionController.getGrantedPermissions() }) { granted ->
            if (granted.containsAll(PERMISSIONS)) {
                call.resolve(JSObject().put("granted", true))
                return@launch
            }
            val intent = PermissionController.createRequestPermissionResultContract(PROVIDER).createIntent(context, PERMISSIONS)
            bridge.activity.runOnUiThread { startActivityForResult(call, intent, "permissionsResult") }
        }
    }

    @ActivityCallback
    private fun permissionsResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val granted = PermissionController.createRequestPermissionResultContract(PROVIDER).parseResult(result.resultCode, result.data)
        // The answer of the dialog can be partial; what counts is what is granted now.
        launch(call, { client().permissionController.getGrantedPermissions() }) { now ->
            call.resolve(JSObject().put("granted", (granted + now).contains(WRITE_SESSION)))
        }
    }

    @PluginMethod
    fun saveWorkout(call: PluginCall) {
        val externalId = call.getString("externalId")
        val fingerprint = call.getString("fingerprint")
        val start = parseInstant(call.getString("start"))
        val end = parseInstant(call.getString("end"))
        val version = fingerprint?.let { fingerprintToVersion(it) }
        if (externalId.isNullOrEmpty() || version == null || start == null || end == null || end.isBefore(start)) {
            call.reject("externalId, fingerprint, start and end are required", "invalid_request")
            return
        }
        val activity = ACTIVITIES[call.getString("activity")] ?: ExerciseSessionRecord.EXERCISE_TYPE_CALISTHENICS
        val title = call.getString("title")
        val distance = call.getDouble("distanceMeters")
        val zone = ZoneId.systemDefault().rules
        val device = Device(Device.TYPE_PHONE, Build.MANUFACTURER, Build.MODEL)

        launch(call, {
            val client = client()
            // Same key and same fingerprint — already there (a repeated save, a second pass).
            val existing = client.readRecords(
                ReadRecordsRequest(
                    recordType = ExerciseSessionRecord::class,
                    timeRangeFilter = TimeRangeFilter.between(start.minusSeconds(1), end.plusSeconds(1)),
                    dataOriginFilter = ownOrigin(),
                ),
            ).records.filter { it.metadata.clientRecordId == externalId }
            if (existing.size == 1 && existing[0].metadata.clientRecordVersion == version) {
                false
            } else {
                val records = mutableListOf<Record>(
                    ExerciseSessionRecord(
                        startTime = start,
                        startZoneOffset = zone.getOffset(start),
                        endTime = end,
                        endZoneOffset = zone.getOffset(end),
                        metadata = Metadata.manualEntry(externalId, version, device),
                        exerciseType = activity,
                        title = title,
                    ),
                )
                val granted = client.permissionController.getGrantedPermissions()
                if (distance != null && distance > 0 && granted.contains(WRITE_DISTANCE)) {
                    records.add(
                        DistanceRecord(
                            startTime = start,
                            startZoneOffset = zone.getOffset(start),
                            endTime = end,
                            endZoneOffset = zone.getOffset(end),
                            distance = Length.meters(distance),
                            metadata = Metadata.manualEntry(externalId + DISTANCE_SUFFIX, version, device),
                        ),
                    )
                }
                deleteOwn(client, externalId)
                client.insertRecords(records)
                true
            }
        }) { saved ->
            val result = JSObject().put("saved", saved)
            if (!saved) result.put("skipped", "exists")
            call.resolve(result)
        }
    }

    @PluginMethod
    fun deleteWorkout(call: PluginCall) {
        val externalId = call.getString("externalId")
        if (externalId.isNullOrEmpty()) {
            call.reject("externalId is required", "invalid_request")
            return
        }
        launch(call, { deleteOwn(client(), externalId) }) { deleted ->
            call.resolve(JSObject().put("deleted", deleted))
        }
    }

    @PluginMethod
    fun listOwn(call: PluginCall) {
        val since = parseInstant(call.getString("since")) ?: Instant.EPOCH
        launch(call, {
            val client = client()
            val records = JSArray()
            var pageToken: String? = null
            do {
                val response = client.readRecords(
                    ReadRecordsRequest(
                        recordType = ExerciseSessionRecord::class,
                        timeRangeFilter = TimeRangeFilter.after(since),
                        dataOriginFilter = ownOrigin(),
                        pageSize = PAGE_SIZE,
                        pageToken = pageToken,
                    ),
                )
                for (record in response.records) {
                    val externalId = record.metadata.clientRecordId ?: continue
                    records.put(
                        JSObject()
                            .put("externalId", externalId)
                            .put("fingerprint", versionToFingerprint(record.metadata.clientRecordVersion)),
                    )
                }
                pageToken = response.pageToken
            } while (!pageToken.isNullOrEmpty())
            records
        }) { records ->
            call.resolve(JSObject().put("records", records))
        }
    }

    @PluginMethod
    fun openSettings(call: PluginCall) {
        val activity = bridge.activity
        val intent = if (sdkStatus() == HealthConnectClient.SDK_AVAILABLE) {
            HealthConnectClient.getHealthConnectManageDataIntent(context, PROVIDER)
        } else {
            // Health Connect page in Google Play; after install it opens its onboarding.
            Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$PROVIDER&url=healthconnect%3A%2F%2Fonboarding")).setPackage("com.android.vending")
        }
        try {
            activity.startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=$PROVIDER")))
        }
        call.resolve()
    }

    /**
     * Deletes the session and its distance by `clientRecordId` (unique per app in Health Connect,
     * so there is never more than one of each). `true` — nothing of this workout is left.
     */
    private suspend fun deleteOwn(client: HealthConnectClient, externalId: String): Boolean {
        deleteByClientIds(client, ExerciseSessionRecord::class, listOf(externalId))
        deleteByClientIds(client, DistanceRecord::class, listOf(externalId + DISTANCE_SUFFIX))
        return true
    }

    private suspend fun deleteByClientIds(client: HealthConnectClient, type: KClass<out Record>, ids: List<String>) {
        client.deleteRecords(type, emptyList(), ids)
    }

    private fun parseInstant(value: String?): Instant? =
        try {
            if (value.isNullOrEmpty()) null else Instant.parse(value)
        } catch (_: Exception) {
            null
        }
}
