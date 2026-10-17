package app.pushuptracker.mobile.plugins

import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.util.concurrent.TimeUnit
import org.json.JSONObject

/**
 * Фоновая отправка записей офлайн-очереди: WorkManager с условием «есть сеть», уникальная работа
 * на каждую запись (`id` = `clientRequestId`), экспоненциальная пауза между попытками.
 * JS: `enqueue({id, url, headers, body, delaySeconds?}) → {queued}`, `cancel({id}) → {cancelled}`,
 * `list() → {items: [{id, state: queued|running|done|failed, httpStatus?}]}`.
 */
@CapacitorPlugin(name = "BackgroundUpload")
class BackgroundUploadPlugin : Plugin() {
    private fun workManager(): WorkManager = WorkManager.getInstance(context.applicationContext)

    private fun current(id: String): WorkInfo? =
        workManager().getWorkInfosForUniqueWork(uniqueName(id)).get().lastOrNull()

    @PluginMethod
    fun enqueue(call: PluginCall) {
        val id = call.getString("id")
        val url = call.getString("url")
        val body = call.getString("body")
        if (id.isNullOrEmpty() || url.isNullOrEmpty() || body == null || !(url.startsWith("https://") || url.startsWith("http://"))) {
            call.reject("id, url and body are required", "invalid_request")
            return
        }
        try {
            when (current(id)?.state) {
                // Уже ждёт или уже отправляется — вторая копия не нужна.
                WorkInfo.State.ENQUEUED, WorkInfo.State.BLOCKED, WorkInfo.State.RUNNING -> {
                    call.resolve(JSObject().put("queued", true))
                    return
                }
                // Уже на сервере.
                WorkInfo.State.SUCCEEDED -> {
                    call.resolve(JSObject().put("queued", false))
                    return
                }
                else -> Unit
            }
            val headers = JSONObject()
            val raw = call.getObject("headers") ?: JSObject()
            for (name in raw.keys()) headers.put(name, raw.optString(name))
            val input = Data.Builder()
                .putString(BackgroundUploadWorker.KEY_ID, id)
                .putString(BackgroundUploadWorker.KEY_URL, url)
                .putString(BackgroundUploadWorker.KEY_HEADERS, headers.toString())
                .putString(BackgroundUploadWorker.KEY_BODY, body)
                .build()
            val delaySeconds = (call.getDouble("delaySeconds") ?: 0.0).coerceAtLeast(0.0).toLong()
            val request = OneTimeWorkRequest.Builder(BackgroundUploadWorker::class.java)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BACKOFF_SECONDS, TimeUnit.SECONDS)
                .setInitialDelay(delaySeconds, TimeUnit.SECONDS)
                .addTag(TAG)
                .addTag(ID_TAG_PREFIX + id)
                .setInputData(input)
                .build()
            workManager().enqueueUniqueWork(uniqueName(id), ExistingWorkPolicy.REPLACE, request).result.get()
            call.resolve(JSObject().put("queued", true))
        } catch (error: Exception) {
            call.reject("Could not queue the upload", "enqueue_failed", error)
        }
    }

    /** `cancelled: true` — копия снята, на сервер она не попадала; `false` — уже отправляется, уже на сервере или её нет. */
    @PluginMethod
    fun cancel(call: PluginCall) {
        val id = call.getString("id")
        if (id.isNullOrEmpty()) {
            call.reject("id is required", "invalid_request")
            return
        }
        try {
            val cancelled = when (current(id)?.state) {
                WorkInfo.State.ENQUEUED, WorkInfo.State.BLOCKED -> {
                    workManager().cancelUniqueWork(uniqueName(id)).result.get()
                    true
                }
                WorkInfo.State.FAILED, WorkInfo.State.CANCELLED -> {
                    workManager().pruneWork()
                    true
                }
                WorkInfo.State.SUCCEEDED -> {
                    workManager().pruneWork()
                    false
                }
                WorkInfo.State.RUNNING, null -> false
            }
            call.resolve(JSObject().put("cancelled", cancelled))
        } catch (error: Exception) {
            call.reject("Could not cancel the upload", "cancel_failed", error)
        }
    }

    @PluginMethod
    fun list(call: PluginCall) {
        try {
            val items = JSArray()
            for (info in workManager().getWorkInfosByTag(TAG).get()) {
                val id = info.tags.firstOrNull { it.startsWith(ID_TAG_PREFIX) }?.removePrefix(ID_TAG_PREFIX) ?: continue
                val state = when (info.state) {
                    WorkInfo.State.ENQUEUED, WorkInfo.State.BLOCKED -> "queued"
                    WorkInfo.State.RUNNING -> "running"
                    WorkInfo.State.SUCCEEDED -> "done"
                    WorkInfo.State.FAILED -> "failed"
                    WorkInfo.State.CANCELLED -> continue
                }
                val item = JSObject().put("id", id).put("state", state)
                val status = info.outputData.getInt(BackgroundUploadWorker.KEY_HTTP_STATUS, 0)
                if (status > 0) item.put("httpStatus", status)
                items.put(item)
            }
            call.resolve(JSObject().put("items", items))
        } catch (error: Exception) {
            call.reject("Could not list uploads", "list_failed", error)
        }
    }

    private fun uniqueName(id: String) = UNIQUE_PREFIX + id

    private companion object {
        const val TAG = "background-upload"
        const val ID_TAG_PREFIX = "background-upload-id:"
        const val UNIQUE_PREFIX = "background-upload:"
        const val BACKOFF_SECONDS = 15L
    }
}
