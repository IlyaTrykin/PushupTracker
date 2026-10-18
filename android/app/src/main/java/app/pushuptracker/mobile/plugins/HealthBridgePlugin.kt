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
import androidx.health.connect.client.request.AggregateRequest
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
 * are read, rewritten and deleted. With the tracker account's tag (`owner`) the key is prefixed:
 * `<owner>|<externalId>`, so another account on this phone never touches the record; a key without
 * the prefix (an older version) counts as the caller's.
 * JS (`src/lib/health/health.ts`): `isAvailable() → {available, reason?}`,
 * `requestPermissions() → {granted}`, `saveWorkout(HealthWorkoutInput) → {saved, skipped?}`,
 * `deleteWorkout({externalId, owner?}) → {deleted}`, `listOwn({since}) → {records: [{externalId, fingerprint, owner?}]}`,
 * `querySessions({since}) → {sessions: [HealthSession]}` (run / bike / row of any app), `openSettings()`.
 */
@CapacitorPlugin(name = "HealthBridge")
class HealthBridgePlugin : Plugin() {
    companion object {
        private const val PROVIDER = "com.google.android.apps.healthdata"
        private const val DISTANCE_SUFFIX = ":distance"
        private const val OWNER_SEPARATOR = '|'
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
        private val READ_SESSION = HealthPermission.getReadPermission(ExerciseSessionRecord::class)
        private val READ_DISTANCE = HealthPermission.getReadPermission(DistanceRecord::class)

        /** Health Connect exercise type → the tracker's cardio exercise (treadmill / stationary count too). */
        private val IMPORT_ACTIVITIES = mapOf(
            ExerciseSessionRecord.EXERCISE_TYPE_RUNNING to "run",
            ExerciseSessionRecord.EXERCISE_TYPE_RUNNING_TREADMILL to "run",
            ExerciseSessionRecord.EXERCISE_TYPE_BIKING to "bike",
            ExerciseSessionRecord.EXERCISE_TYPE_BIKING_STATIONARY to "bike",
            ExerciseSessionRecord.EXERCISE_TYPE_ROWING to "row",
            ExerciseSessionRecord.EXERCISE_TYPE_ROWING_MACHINE to "row",
        )

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

        /** `clientRecordId` of a workout of `owner` (a `clientRequestId` never contains `|`). */
        fun recordKey(externalId: String, owner: String?): String =
            if (owner.isNullOrEmpty()) externalId else "$owner$OWNER_SEPARATOR$externalId"

        /** `clientRecordId` → (owner or null, externalId). */
        fun parseRecordKey(key: String): Pair<String?, String> {
            val at = key.indexOf(OWNER_SEPARATOR)
            return if (at > 0) key.substring(0, at) to key.substring(at + 1) else null to key
        }
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
        val owner = call.getString("owner")?.takeIf { it.isNotEmpty() }
        val key = recordKey(externalId, owner)
        val title = call.getString("title")
        val distance = call.getDouble("distanceMeters")
        val zone = ZoneId.systemDefault().rules
        val device = Device(Device.TYPE_PHONE, Build.MANUFACTURER, Build.MODEL)

        launch(call, {
            val client = client()
            // Same key (with the owner) and same fingerprint — already there (a repeated save, a second
            // pass). A record of an older version (key without the owner) is rewritten once.
            val existing = client.readRecords(
                ReadRecordsRequest(
                    recordType = ExerciseSessionRecord::class,
                    timeRangeFilter = TimeRangeFilter.between(start.minusSeconds(1), end.plusSeconds(1)),
                    dataOriginFilter = ownOrigin(),
                ),
            ).records.filter { it.metadata.clientRecordId == key || it.metadata.clientRecordId == externalId }
            if (existing.size == 1 && existing[0].metadata.clientRecordId == key && existing[0].metadata.clientRecordVersion == version) {
                false
            } else {
                val records = mutableListOf<Record>(
                    ExerciseSessionRecord(
                        startTime = start,
                        startZoneOffset = zone.getOffset(start),
                        endTime = end,
                        endZoneOffset = zone.getOffset(end),
                        metadata = Metadata.manualEntry(key, version, device),
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
                            metadata = Metadata.manualEntry(key + DISTANCE_SUFFIX, version, device),
                        ),
                    )
                }
                deleteOwn(client, externalId, owner, granted.contains(WRITE_DISTANCE))
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
        val owner = call.getString("owner")?.takeIf { it.isNotEmpty() }
        launch(call, {
            val client = client()
            deleteOwn(client, externalId, owner, client.permissionController.getGrantedPermissions().contains(WRITE_DISTANCE))
        }) { deleted ->
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
                    val (owner, externalId) = parseRecordKey(record.metadata.clientRecordId ?: continue)
                    val item = JSObject()
                        .put("externalId", externalId)
                        .put("fingerprint", versionToFingerprint(record.metadata.clientRecordVersion))
                    if (owner != null) item.put("owner", owner)
                    records.put(item)
                }
                pageToken = response.pageToken
            } while (!pageToken.isNullOrEmpty())
            records
        }) { records ->
            call.resolve(JSObject().put("records", records))
        }
    }

    /**
     * Runs, rides and rows since `since` from every app (newest first), distance in metres summed
     * over the session from the same app (null without a distance or without read permission).
     */
    @PluginMethod
    fun querySessions(call: PluginCall) {
        val since = parseInstant(call.getString("since"))
        if (since == null) {
            call.reject("since is required", "invalid_request")
            return
        }
        launch(call, {
            val client = client()
            val granted = client.permissionController.getGrantedPermissions()
            if (!granted.contains(READ_SESSION)) throw SecurityException("No permission to read workouts")
            val canReadDistance = granted.contains(READ_DISTANCE)
            val found = mutableListOf<ExerciseSessionRecord>()
            var pageToken: String? = null
            do {
                val response = client.readRecords(
                    ReadRecordsRequest(
                        recordType = ExerciseSessionRecord::class,
                        timeRangeFilter = TimeRangeFilter.after(since),
                        pageSize = PAGE_SIZE,
                        pageToken = pageToken,
                    ),
                )
                found.addAll(response.records.filter { IMPORT_ACTIVITIES.containsKey(it.exerciseType) })
                pageToken = response.pageToken
            } while (!pageToken.isNullOrEmpty())

            val sessions = JSArray()
            for (record in found.sortedByDescending { it.endTime }) {
                val origin = record.metadata.dataOrigin.packageName
                val session = JSObject()
                    .put("id", record.metadata.id)
                    .put("platform", "health_connect")
                    .put("activity", IMPORT_ACTIVITIES[record.exerciseType])
                    .put("start", record.startTime.toString())
                    .put("end", record.endTime.toString())
                    .put("sourceName", sourceName(origin))
                    .put("fromThisApp", origin == context.packageName)
                if (canReadDistance) {
                    val meters = try {
                        client.aggregate(
                            AggregateRequest(
                                metrics = setOf(DistanceRecord.DISTANCE_TOTAL),
                                timeRangeFilter = TimeRangeFilter.between(record.startTime, record.endTime),
                                dataOriginFilter = setOf(record.metadata.dataOrigin),
                            ),
                        )[DistanceRecord.DISTANCE_TOTAL]?.inMeters
                    } catch (_: SecurityException) {
                        null
                    }
                    if (meters != null && meters > 0) session.put("distanceMeters", meters)
                }
                sessions.put(session)
            }
            sessions
        }) { sessions ->
            call.resolve(JSObject().put("sessions", sessions))
        }
    }

    /** The app's label when the system lets us see it, else its package name. */
    private fun sourceName(packageName: String): String =
        try {
            val info = context.packageManager.getApplicationInfo(packageName, 0)
            context.packageManager.getApplicationLabel(info).toString()
        } catch (_: Exception) {
            packageName
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
     * Without the distance write permission (the user granted workouts only) the distance is not
     * touched: deleting it would throw SecurityException and fail the whole save (a distance written
     * before the permission was taken back stays — Health Connect does not let the app change it).
     */
    private suspend fun deleteOwn(client: HealthConnectClient, externalId: String, owner: String?, canWriteDistance: Boolean): Boolean {
        // This owner's key and the key of an older version without an owner; never another owner's.
        val keys = listOf(recordKey(externalId, owner), externalId).distinct()
        deleteByClientIds(client, ExerciseSessionRecord::class, keys)
        if (canWriteDistance) deleteByClientIds(client, DistanceRecord::class, keys.map { it + DISTANCE_SUFFIX })
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
