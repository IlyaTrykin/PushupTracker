package app.pushuptracker.mobile.plugins

import android.content.Context
import androidx.work.Data
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject

/**
 * Одна фоновая отправка тренировки из очереди: тот же POST, что делает JS (адрес, заголовки с
 * Bearer, тело с постоянным `clientRequestId` — повтор не создаёт дубля). Запускается WorkManager'ом
 * при наличии сети, даже если приложение закрыто.
 *
 * 2xx — готово; 4xx (в т.ч. 401 — ждём входа) — провал, JS получит тот же ответ сам;
 * сеть, 408, 429, 5xx — повтор с экспоненциальной паузой.
 */
class BackgroundUploadWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val url = inputData.getString(KEY_URL) ?: return Result.failure()
        val body = inputData.getString(KEY_BODY) ?: return Result.failure()
        val headers = try {
            JSONObject(inputData.getString(KEY_HEADERS) ?: "{}")
        } catch (error: Exception) {
            JSONObject()
        }

        var connection: HttpURLConnection? = null
        return try {
            connection = (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = CONNECT_TIMEOUT_MS
                readTimeout = READ_TIMEOUT_MS
                doOutput = true
                useCaches = false
                for (name in headers.keys()) setRequestProperty(name, headers.optString(name))
            }
            connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val status = connection.responseCode
            // Ответ не нужен, но соединение закрывается чисто.
            try {
                (if (status >= 400) connection.errorStream else connection.inputStream)?.use { it.readBytes() }
            } catch (_: IOException) {
            }
            val output = Data.Builder().putInt(KEY_HTTP_STATUS, status).build()
            when {
                status in 200..299 -> Result.success(output)
                status == 408 || status == 429 || status >= 500 -> Result.retry()
                else -> Result.failure(output)
            }
        } catch (error: IOException) {
            Result.retry()
        } finally {
            connection?.disconnect()
        }
    }

    companion object {
        const val KEY_ID = "id"
        const val KEY_URL = "url"
        const val KEY_HEADERS = "headers"
        const val KEY_BODY = "body"
        const val KEY_HTTP_STATUS = "httpStatus"
        private const val CONNECT_TIMEOUT_MS = 20_000
        private const val READ_TIMEOUT_MS = 30_000
    }
}
