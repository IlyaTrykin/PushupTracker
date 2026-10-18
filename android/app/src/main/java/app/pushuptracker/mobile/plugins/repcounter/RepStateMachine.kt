package app.pushuptracker.mobile.plugins.repcounter

import kotlin.math.acos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

// Rep counting algorithm (interfaces.md §7) — pure Kotlin, no Android classes, so JUnit runs it on
// the JVM. The same algorithm lives in Swift (ios/App/App/Plugins/RepStateMachine.swift); keep the
// two in step.

enum class RepExercise(val id: String) {
    PUSHUPS("pushups"), SQUATS("squats"), PULLUPS("pullups");

    companion object {
        fun fromId(id: String?): RepExercise? = entries.firstOrNull { it.id == id }
    }
}

/** Body key points the counter looks at (ML Kit and Vision names map onto these). */
enum class PoseJoint {
    NOSE,
    LEFT_SHOULDER, RIGHT_SHOULDER,
    LEFT_ELBOW, RIGHT_ELBOW,
    LEFT_WRIST, RIGHT_WRIST,
    LEFT_HIP, RIGHT_HIP,
    LEFT_KNEE, RIGHT_KNEE,
    LEFT_ANKLE, RIGHT_ANKLE,
}

data class PosePoint(val x: Double, val y: Double, val confidence: Double)

object PoseGeometry {
    const val MIN_CONFIDENCE = 0.5

    /** Angle at [b] between the rays to [a] and [c], in degrees (0…180). */
    fun angle(a: PosePoint, b: PosePoint, c: PosePoint): Double {
        val v1x = a.x - b.x
        val v1y = a.y - b.y
        val v2x = c.x - b.x
        val v2y = c.y - b.y
        val len = sqrt(v1x * v1x + v1y * v1y) * sqrt(v2x * v2x + v2y * v2y)
        if (len <= 0.0) return 0.0
        val cosine = max(-1.0, min(1.0, (v1x * v2x + v1y * v2y) / len))
        return Math.toDegrees(acos(cosine))
    }

    fun confident(point: PosePoint?): PosePoint? = point?.takeIf { it.confidence >= MIN_CONFIDENCE }
}

/**
 * One analysed camera frame: the joint angle in degrees, `null` when the key points were not found
 * with confidence ≥ 0.5; for pull-ups also whether the nose is above the line of the wrists.
 */
data class PoseFrame(val time: Double, val angle: Double?, val headAboveWrists: Boolean? = null) {
    companion object {
        /**
         * Key points → frame. Push-ups and pull-ups: elbow (shoulder–elbow–wrist); squats: knee
         * (hip–knee–ankle); of the two sides the one whose weakest point is more confident.
         * [yGrowsUp]: Vision's normalised coordinates grow upward, ML Kit's image pixels downward.
         */
        fun from(joints: Map<PoseJoint, PosePoint>, exercise: RepExercise, time: Double, yGrowsUp: Boolean): PoseFrame {
            val sides = if (exercise == RepExercise.SQUATS) {
                listOf(
                    Triple(PoseJoint.LEFT_HIP, PoseJoint.LEFT_KNEE, PoseJoint.LEFT_ANKLE),
                    Triple(PoseJoint.RIGHT_HIP, PoseJoint.RIGHT_KNEE, PoseJoint.RIGHT_ANKLE),
                )
            } else {
                listOf(
                    Triple(PoseJoint.LEFT_SHOULDER, PoseJoint.LEFT_ELBOW, PoseJoint.LEFT_WRIST),
                    Triple(PoseJoint.RIGHT_SHOULDER, PoseJoint.RIGHT_ELBOW, PoseJoint.RIGHT_WRIST),
                )
            }
            var bestConfidence = -1.0
            var bestAngle: Double? = null
            for ((first, middle, last) in sides) {
                val a = PoseGeometry.confident(joints[first]) ?: continue
                val b = PoseGeometry.confident(joints[middle]) ?: continue
                val c = PoseGeometry.confident(joints[last]) ?: continue
                val confidence = minOf(a.confidence, b.confidence, c.confidence)
                if (confidence > bestConfidence) {
                    bestConfidence = confidence
                    bestAngle = PoseGeometry.angle(a, b, c)
                }
            }
            var head: Boolean? = null
            val nose = PoseGeometry.confident(joints[PoseJoint.NOSE])
            if (exercise == RepExercise.PULLUPS && nose != null) {
                val wrists = listOfNotNull(
                    PoseGeometry.confident(joints[PoseJoint.LEFT_WRIST]),
                    PoseGeometry.confident(joints[PoseJoint.RIGHT_WRIST]),
                )
                if (wrists.isNotEmpty()) {
                    val line = wrists.sumOf { it.y } / wrists.size
                    head = if (yGrowsUp) nose.y > line else nose.y < line
                }
            }
            return PoseFrame(time, bestAngle, head)
        }
    }
}

/**
 * Counts reps from pose frames: median of the last 3 frames, hysteresis between the «down» and
 * «up» thresholds, a rep on the move down → up, not more often than once in 0.6 s; more than
 * 1.5 s without the pose → [showHint] («stand so the whole body is visible») and the phase is
 * forgotten (the person may have moved).
 */
class RepStateMachine(val exercise: RepExercise) {
    companion object {
        const val MIN_REP_INTERVAL = 0.6
        const val POSE_LOST_HINT = 1.5
        const val SMOOTHING_WINDOW = 3

        fun median(values: List<Double>): Double {
            if (values.isEmpty()) return 0.0
            val sorted = values.sorted()
            val mid = sorted.size / 2
            return if (sorted.size % 2 == 1) sorted[mid] else (sorted[mid - 1] + sorted[mid]) / 2
        }
    }

    private enum class Phase { UNKNOWN, DOWN, UP }

    var reps = 0
        private set
    var showHint = false
        private set

    private var phase = Phase.UNKNOWN
    private val angles = ArrayDeque<Double>()
    private val heads = ArrayDeque<Boolean>()
    private var lastPoseTime: Double? = null
    private var lastRepTime: Double? = null

    private val downBelow = 100.0
    private val upAbove = if (exercise == RepExercise.SQUATS) 160.0 else 150.0

    /** Feeds one frame; `true` when it completed a rep. */
    fun process(frame: PoseFrame): Boolean {
        val angle = frame.angle
        if (angle == null || (exercise == RepExercise.PULLUPS && frame.headAboveWrists == null)) {
            if (lastPoseTime == null) lastPoseTime = frame.time // counting from the first frame
            if (frame.time - (lastPoseTime ?: frame.time) > POSE_LOST_HINT && !showHint) {
                showHint = true
                phase = Phase.UNKNOWN
                angles.clear()
                heads.clear()
            }
            return false
        }
        lastPoseTime = frame.time
        showHint = false
        push(angles, angle)
        frame.headAboveWrists?.let { push(heads, it) }

        val smoothed = median(angles.toList())
        val next: Phase? = if (exercise == RepExercise.PULLUPS) {
            val headUp = heads.count { it } * 2 > heads.size
            when {
                headUp -> Phase.UP
                smoothed > upAbove -> Phase.DOWN
                else -> null
            }
        } else {
            when {
                smoothed < downBelow -> Phase.DOWN
                smoothed > upAbove -> Phase.UP
                else -> null
            }
        }
        if (next == null || next == phase) return false
        val wasDown = phase == Phase.DOWN
        phase = next
        if (!wasDown || next != Phase.UP) return false
        val last = lastRepTime
        if (last != null && frame.time - last < MIN_REP_INTERVAL) return false
        lastRepTime = frame.time
        reps += 1
        return true
    }

    private fun <T> push(window: ArrayDeque<T>, value: T) {
        window.addLast(value)
        while (window.size > SMOOTHING_WINDOW) window.removeFirst()
    }
}

/**
 * «Touch with the chest»: the proximity sensor going near → far is a rep; a far that comes less
 * than 0.4 s after the previous counted rep is sensor bounce and is dropped.
 */
class ProximityRepCounter {
    companion object {
        const val BOUNCE_INTERVAL = 0.4
    }

    var reps = 0
        private set
    private var near = false
    private var lastRepTime: Double? = null

    /** Feeds one sensor reading; `true` when it completed a rep. */
    fun process(time: Double, near: Boolean): Boolean {
        if (near == this.near) return false
        this.near = near
        if (near) return false
        val last = lastRepTime
        if (last != null && time - last < BOUNCE_INTERVAL) return false
        lastRepTime = time
        reps += 1
        return true
    }
}
