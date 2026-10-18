package app.pushuptracker.mobile.plugins.repcounter

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.annotation.OptIn
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.camera2.Camera2Config
import androidx.camera.core.CameraXConfig
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.pose.Pose
import com.google.mlkit.vision.pose.PoseDetection
import com.google.mlkit.vision.pose.PoseDetector
import com.google.mlkit.vision.pose.PoseLandmark
import com.google.mlkit.vision.pose.defaults.PoseDetectorOptions
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Full-screen rep counter (interfaces.md §7): CameraX preview with ML Kit pose detection (bundled
 * model, works offline) or a dark screen for the proximity sensor; a big counter, a short beep on
 * every counted rep, the hint «stand so the whole body is visible» when the pose is lost for more
 * than 1.5 s, «Готово» / «Отмена». Counting itself is [RepStateMachine] / [ProximityRepCounter].
 * Result: [RESULT_REPS], [RESULT_DURATION], [RESULT_CANCELLED].
 */
class RepCounterActivity : AppCompatActivity(), SensorEventListener {
    companion object {
        const val EXTRA_MODE = "mode"
        const val EXTRA_EXERCISE = "exerciseType"
        const val EXTRA_LOCALE = "locale"
        const val MODE_CAMERA = "camera"
        const val MODE_NO_CAMERA = "no_camera"
        const val MODE_PROXIMITY = "proximity"
        const val RESULT_REPS = "reps"
        const val RESULT_DURATION = "durationSeconds"
        const val RESULT_CANCELLED = "cancelled"
        private const val TAG = "RepCounter"
        private var cameraXConfigured = false

        /** Front camera when there is one (the phone faces the person), the back one otherwise. */
        fun chooseCamera(context: Context): CameraSelector {
            val manager = context.getSystemService(Context.CAMERA_SERVICE) as? CameraManager
            val facings = runCatching {
                manager?.cameraIdList?.map { manager.getCameraCharacteristics(it).get(CameraCharacteristics.LENS_FACING) }
            }.getOrNull().orEmpty()
            return if (facings.contains(CameraCharacteristics.LENS_FACING_FRONT)) {
                CameraSelector.DEFAULT_FRONT_CAMERA
            } else {
                CameraSelector.DEFAULT_BACK_CAMERA
            }
        }

        /**
         * CameraX is limited to the chosen camera: devices (and the emulator) that declare a camera
         * feature without the camera otherwise fail CameraX's start-up check and show no preview.
         * Once per process, before the first `ProcessCameraProvider.getInstance`.
         */
        fun configureCameraX(selector: CameraSelector) {
            if (cameraXConfigured) return
            cameraXConfigured = true
            runCatching {
                ProcessCameraProvider.configureInstance(
                    CameraXConfig.Builder.fromConfig(Camera2Config.defaultConfig())
                        .setAvailableCamerasLimiter(selector)
                        .build(),
                )
            }.onFailure { Log.w(TAG, "CameraX already configured", it) }
        }

        private val LANDMARKS = mapOf(
            PoseLandmark.NOSE to PoseJoint.NOSE,
            PoseLandmark.LEFT_SHOULDER to PoseJoint.LEFT_SHOULDER,
            PoseLandmark.RIGHT_SHOULDER to PoseJoint.RIGHT_SHOULDER,
            PoseLandmark.LEFT_ELBOW to PoseJoint.LEFT_ELBOW,
            PoseLandmark.RIGHT_ELBOW to PoseJoint.RIGHT_ELBOW,
            PoseLandmark.LEFT_WRIST to PoseJoint.LEFT_WRIST,
            PoseLandmark.RIGHT_WRIST to PoseJoint.RIGHT_WRIST,
            PoseLandmark.LEFT_HIP to PoseJoint.LEFT_HIP,
            PoseLandmark.RIGHT_HIP to PoseJoint.RIGHT_HIP,
            PoseLandmark.LEFT_KNEE to PoseJoint.LEFT_KNEE,
            PoseLandmark.RIGHT_KNEE to PoseJoint.RIGHT_KNEE,
            PoseLandmark.LEFT_ANKLE to PoseJoint.LEFT_ANKLE,
            PoseLandmark.RIGHT_ANKLE to PoseJoint.RIGHT_ANKLE,
        )
    }

    private lateinit var mode: String
    private lateinit var exercise: RepExercise
    private lateinit var texts: RepCounterTexts
    private lateinit var machine: RepStateMachine
    private val proximityCounter = ProximityRepCounter()

    private lateinit var counterView: TextView
    private lateinit var clockView: TextView
    private lateinit var hintView: TextView
    private lateinit var messageView: TextView
    private var previewView: PreviewView? = null

    private var reps = 0
    private var startedAt = 0L
    private var finished = false
    private val handler = Handler(Looper.getMainLooper())
    private val clockTick = object : Runnable {
        override fun run() {
            updateClock()
            handler.postDelayed(this, 500)
        }
    }

    private var tone: ToneGenerator? = null
    private var sensorManager: SensorManager? = null
    private var proximitySensor: Sensor? = null
    private var cameraProvider: ProcessCameraProvider? = null
    private var analysisExecutor: ExecutorService? = null
    private var detector: PoseDetector? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        mode = intent.getStringExtra(EXTRA_MODE) ?: MODE_CAMERA
        exercise = RepExercise.fromId(intent.getStringExtra(EXTRA_EXERCISE)) ?: RepExercise.PUSHUPS
        texts = RepCounterTexts(intent.getStringExtra(EXTRA_LOCALE) ?: "ru")
        machine = RepStateMachine(exercise)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContentView(buildInterface())
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = finishWith(cancelled = true)
        })
        tone = runCatching { ToneGenerator(AudioManager.STREAM_MUSIC, 90) }.getOrNull()
        startedAt = SystemClock.elapsedRealtime()
        handler.post(clockTick)
        when (mode) {
            MODE_CAMERA -> startCamera()
            MODE_PROXIMITY -> {
                showMessage(texts.proximityHelp)
                sensorManager = getSystemService(SENSOR_SERVICE) as? SensorManager
                proximitySensor = sensorManager?.getDefaultSensor(Sensor.TYPE_PROXIMITY)
            }
            else -> showMessage(texts.noCamera)
        }
    }

    override fun onResume() {
        super.onResume()
        proximitySensor?.let { sensorManager?.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
    }

    override fun onPause() {
        super.onPause()
        sensorManager?.unregisterListener(this)
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        cameraProvider?.unbindAll()
        detector?.close()
        analysisExecutor?.shutdown()
        tone?.release()
        super.onDestroy()
    }

    // interface

    private fun dp(value: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()

    private fun rounded(color: Int, radius: Int) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(radius).toFloat()
    }

    private fun buildInterface(): View {
        val root = FrameLayout(this)
        root.setBackgroundColor(Color.BLACK)
        if (mode == MODE_CAMERA) {
            val preview = PreviewView(this)
            preview.scaleType = PreviewView.ScaleType.FILL_CENTER
            root.addView(preview, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            previewView = preview
        }

        val overlay = LinearLayout(this)
        overlay.orientation = LinearLayout.VERTICAL
        overlay.setPadding(dp(16), dp(16), dp(16), dp(16))

        val title = TextView(this)
        title.text = texts.title(exercise, proximity = mode == MODE_PROXIMITY)
        title.setTextColor(Color.WHITE)
        title.textSize = 20f
        title.setTypeface(title.typeface, Typeface.BOLD)
        title.gravity = Gravity.CENTER
        title.setShadowLayer(12f, 0f, 0f, Color.BLACK)
        overlay.addView(title)

        hintView = TextView(this)
        hintView.text = texts.hint
        hintView.setTextColor(Color.BLACK)
        hintView.textSize = 18f
        hintView.gravity = Gravity.CENTER
        hintView.setPadding(dp(16), dp(12), dp(16), dp(12))
        hintView.background = rounded(Color.argb(242, 250, 191, 36), 16)
        hintView.visibility = View.GONE
        overlay.addView(hintView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            topMargin = dp(16)
        })

        overlay.addView(View(this), LinearLayout.LayoutParams(0, 0, 1f))

        counterView = TextView(this)
        counterView.text = "0"
        counterView.setTextColor(Color.WHITE)
        counterView.textSize = 140f
        counterView.typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        counterView.gravity = Gravity.CENTER
        counterView.setShadowLayer(24f, 0f, 0f, Color.BLACK)
        counterView.contentDescription = "repCounterValue"
        overlay.addView(counterView)

        clockView = TextView(this)
        clockView.text = "0:00"
        clockView.setTextColor(Color.argb(204, 255, 255, 255))
        clockView.textSize = 22f
        clockView.gravity = Gravity.CENTER
        clockView.setShadowLayer(12f, 0f, 0f, Color.BLACK)
        overlay.addView(clockView)

        overlay.addView(View(this), LinearLayout.LayoutParams(0, 0, 1f))

        messageView = TextView(this)
        messageView.setTextColor(Color.WHITE)
        messageView.textSize = 18f
        messageView.gravity = Gravity.CENTER
        messageView.visibility = View.GONE
        overlay.addView(messageView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            bottomMargin = dp(24)
        })

        val buttons = LinearLayout(this)
        buttons.orientation = LinearLayout.HORIZONTAL
        val cancel = button(texts.cancel, Color.argb(64, 255, 255, 255)) { finishWith(cancelled = true) }
        val done = button(texts.done, Color.rgb(249, 115, 22)) { finishWith(cancelled = false) }
        buttons.addView(cancel, LinearLayout.LayoutParams(0, dp(64), 1f).apply { marginEnd = dp(6) })
        buttons.addView(done, LinearLayout.LayoutParams(0, dp(64), 1f).apply { marginStart = dp(6) })
        overlay.addView(buttons)

        root.addView(overlay, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        // Edge-to-edge (target SDK 35+): keep the text and buttons off the system bars.
        ViewCompat.setOnApplyWindowInsetsListener(overlay) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            view.setPadding(dp(16) + bars.left, dp(16) + bars.top, dp(16) + bars.right, dp(16) + bars.bottom)
            insets
        }
        return root
    }

    private fun button(label: String, color: Int, onClick: () -> Unit): Button {
        val button = Button(this)
        button.text = label
        button.isAllCaps = false
        button.setTextColor(Color.WHITE)
        button.textSize = 20f
        button.setTypeface(button.typeface, Typeface.BOLD)
        button.background = rounded(color, 20)
        button.setOnClickListener { onClick() }
        return button
    }

    private fun showMessage(text: String) {
        messageView.text = text
        messageView.visibility = View.VISIBLE
    }

    private fun updateClock() {
        val seconds = ((SystemClock.elapsedRealtime() - startedAt) / 1000).toInt()
        clockView.text = String.format("%d:%02d", seconds / 60, seconds % 60)
    }

    /** Main thread: new count / hint state from the camera or the sensor. */
    private fun show(count: Int, hint: Boolean, counted: Boolean) {
        if (finished) return
        reps = count
        counterView.text = count.toString()
        hintView.visibility = if (hint) View.VISIBLE else View.GONE
        if (counted) {
            tone?.startTone(ToneGenerator.TONE_PROP_BEEP, 120)
            counterView.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
        }
    }

    // camera

    private fun startCamera() {
        val preview = previewView ?: return
        detector = PoseDetection.getClient(
            PoseDetectorOptions.Builder().setDetectorMode(PoseDetectorOptions.STREAM_MODE).build(),
        )
        val executor = Executors.newSingleThreadExecutor()
        analysisExecutor = executor
        val selector = chooseCamera(this)
        configureCameraX(selector)
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            try {
                val provider = future.get()
                cameraProvider = provider
                val previewUseCase = Preview.Builder().build()
                previewUseCase.setSurfaceProvider(preview.surfaceProvider)
                val analysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                analysis.setAnalyzer(executor) { image -> analyze(image) }
                provider.unbindAll()
                provider.bindToLifecycle(this, selector, previewUseCase, analysis)
            } catch (error: Exception) {
                Log.w(TAG, "camera failed", error)
                showMessage(texts.cameraFailed)
            }
        }, ContextCompat.getMainExecutor(this))
    }

    @OptIn(ExperimentalGetImage::class)
    private fun analyze(image: ImageProxy) {
        val media = image.image
        val client = detector
        if (media == null || client == null) {
            image.close()
            return
        }
        val time = image.imageInfo.timestamp / 1_000_000_000.0
        val input = InputImage.fromMediaImage(media, image.imageInfo.rotationDegrees)
        client.process(input)
            .addOnSuccessListener { pose -> handlePose(pose, time) }
            .addOnFailureListener { handlePose(null, time) }
            .addOnCompleteListener { image.close() }
    }

    /** Main thread (ML Kit task listeners). */
    private fun handlePose(pose: Pose?, time: Double) {
        if (finished) return
        val joints = HashMap<PoseJoint, PosePoint>()
        if (pose != null) {
            for ((type, joint) in LANDMARKS) {
                val landmark = pose.getPoseLandmark(type) ?: continue
                joints[joint] = PosePoint(landmark.position.x.toDouble(), landmark.position.y.toDouble(), landmark.inFrameLikelihood.toDouble())
            }
        }
        val counted = machine.process(PoseFrame.from(joints, exercise, time, yGrowsUp = false))
        show(machine.reps, machine.showHint, counted)
    }

    // proximity

    override fun onSensorChanged(event: SensorEvent) {
        if (event.sensor.type != Sensor.TYPE_PROXIMITY) return
        val range = event.sensor.maximumRange
        val farFrom = if (range > 0f) range else 1f
        val near = event.values[0] < farFrom
        val counted = proximityCounter.process(event.timestamp / 1_000_000_000.0, near)
        show(proximityCounter.reps, false, counted)
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    // finish

    private fun finishWith(cancelled: Boolean) {
        if (finished) return
        finished = true
        val duration = maxOf(1, Math.round((SystemClock.elapsedRealtime() - startedAt) / 1000.0).toInt())
        setResult(
            RESULT_OK,
            Intent()
                .putExtra(RESULT_REPS, reps)
                .putExtra(RESULT_DURATION, duration)
                .putExtra(RESULT_CANCELLED, cancelled),
        )
        finish()
    }
}

/** Texts of the native screen (ru / en, like the rest of the app). */
class RepCounterTexts(locale: String) {
    private val ru = locale != "en"

    val done = if (ru) "Готово" else "Done"
    val cancel = if (ru) "Отмена" else "Cancel"
    val hint = if (ru) "Встаньте так, чтобы было видно всё тело" else "Stand so that your whole body is visible"
    val noCamera = if (ru) {
        "На этом устройстве нет камеры — посчитать повторения камерой не получится. Нажмите «Отмена» и введите число вручную."
    } else {
        "This device has no camera, so reps can't be counted with it. Tap Cancel and enter the number yourself."
    }
    val cameraFailed = if (ru) {
        "Не удалось включить камеру. Нажмите «Отмена» и введите число вручную."
    } else {
        "Couldn't start the camera. Tap Cancel and enter the number yourself."
    }
    val proximityHelp = if (ru) {
        "Положите телефон экраном вверх под грудь. Каждое касание груди — повторение."
    } else {
        "Put the phone face up under your chest. Every touch with the chest is a rep."
    }

    fun title(exercise: RepExercise, proximity: Boolean): String {
        val name = when (exercise) {
            RepExercise.PUSHUPS -> if (ru) "Отжимания" else "Push-ups"
            RepExercise.SQUATS -> if (ru) "Приседания" else "Squats"
            RepExercise.PULLUPS -> if (ru) "Подтягивания" else "Pull-ups"
        }
        return when {
            proximity -> if (ru) "$name · касание" else "$name · touch"
            else -> if (ru) "$name · камера" else "$name · camera"
        }
    }
}
