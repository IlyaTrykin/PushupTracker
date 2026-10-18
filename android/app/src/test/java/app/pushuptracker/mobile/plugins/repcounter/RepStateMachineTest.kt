package app.pushuptracker.mobile.plugins.repcounter

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * RepStateMachine / ProximityRepCounter / PoseGeometry (interfaces.md §7) — the same cases as the
 * Swift XCTest. Frames come at 10 fps (0.1 s apart) unless a test sets the times; expected counts
 * are worked out by hand.
 */
class RepStateMachineTest {
    private fun run(machine: RepStateMachine, angles: List<Double?>, from: Double = 0.0): Double {
        angles.forEachIndexed { index, angle -> machine.process(PoseFrame(from + index * 0.1, angle)) }
        return from + angles.size * 0.1
    }

    private fun repeated(value: Double?, count: Int): List<Double?> = List(count) { value }

    private fun runPullups(machine: RepStateMachine, frames: List<Pair<Double, Boolean>>, from: Double = 0.0): Double {
        frames.forEachIndexed { index, (angle, head) -> machine.process(PoseFrame(from + index * 0.1, angle, head)) }
        return from + frames.size * 0.1
    }

    // push-ups — elbow: down < 100°, up > 150°

    @Test
    fun pushupsCountOnDownToUp() {
        val machine = RepStateMachine(RepExercise.PUSHUPS)
        run(machine, repeated(170.0, 3) + repeated(90.0, 3) + repeated(170.0, 3) + repeated(90.0, 3) + repeated(170.0, 3))
        assertEquals(2, machine.reps)
    }

    @Test
    fun pushupsStartingAtTheBottomCountOnce() {
        val machine = RepStateMachine(RepExercise.PUSHUPS)
        run(machine, repeated(90.0, 3) + repeated(170.0, 3))
        assertEquals(1, machine.reps)
    }

    @Test
    fun pushupsHysteresis() {
        val shallow = RepStateMachine(RepExercise.PUSHUPS)
        run(shallow, repeated(170.0, 3) + repeated(120.0, 3) + repeated(170.0, 3))
        assertEquals("never below 100° — not a rep", 0, shallow.reps)

        val halfway = RepStateMachine(RepExercise.PUSHUPS)
        run(halfway, repeated(170.0, 3) + repeated(95.0, 3) + repeated(140.0, 3) + repeated(95.0, 3))
        assertEquals("140° is not above 150° — still down", 0, halfway.reps)
        run(halfway, repeated(155.0, 3), from = 1.2)
        assertEquals(1, halfway.reps)
    }

    // squats — knee: down < 100°, up > 160°

    @Test
    fun squatsNeedFullStand() {
        val machine = RepStateMachine(RepExercise.SQUATS)
        var time = run(machine, repeated(170.0, 3) + repeated(90.0, 3) + repeated(155.0, 3))
        assertEquals("155° is not above 160°", 0, machine.reps)
        time = run(machine, repeated(165.0, 3), from = time)
        assertEquals(1, machine.reps)
        run(machine, repeated(85.0, 3) + repeated(170.0, 3), from = time)
        assertEquals(2, machine.reps)
    }

    // pull-ups — up: nose above the wrists; down: elbow > 150°

    private val hang = List(4) { 170.0 to false }
    private val top = List(4) { 70.0 to true }

    @Test
    fun pullupsCountHangToChinOverBar() {
        val machine = RepStateMachine(RepExercise.PULLUPS)
        runPullups(machine, hang + top + hang + top)
        assertEquals(2, machine.reps)
    }

    @Test
    fun pullupsWithoutFullHangCountOnce() {
        val machine = RepStateMachine(RepExercise.PULLUPS)
        runPullups(machine, hang + top + List(4) { 120.0 to false } + top)
        assertEquals("elbow never straightened again", 1, machine.reps)
    }

    @Test
    fun pullupsNeedBothSignals() {
        val machine = RepStateMachine(RepExercise.PULLUPS)
        var time = 0.0
        repeat(4) { machine.process(PoseFrame(time, 170.0, false)); time += 0.1 }
        repeat(4) { machine.process(PoseFrame(time, 70.0, null)); time += 0.1 }
        assertEquals(0, machine.reps)
    }

    // jitter (median of 3)

    @Test
    fun singleFrameJitterIsIgnored() {
        val dip = RepStateMachine(RepExercise.PUSHUPS)
        run(dip, repeated(170.0, 4) + listOf(90.0) + repeated(170.0, 4))
        assertEquals("one 90° frame is noise", 0, dip.reps)

        val spike = RepStateMachine(RepExercise.PUSHUPS)
        run(spike, repeated(170.0, 3) + repeated(90.0, 4) + listOf(170.0) + repeated(90.0, 4) + repeated(170.0, 3))
        assertEquals("one 170° frame at the bottom is noise", 1, spike.reps)
    }

    // rate — not more often than one rep in 0.6 s

    @Test
    fun repsFasterThanOnePerSixTenthsAreDropped() {
        // 2 frames down, 2 up: a rise every 0.4 s at 0.5, 0.9, 1.3, 1.7, 2.1, 2.5 s.
        val machine = RepStateMachine(RepExercise.PUSHUPS)
        val angles = mutableListOf<Double?>(170.0, 170.0)
        repeat(6) { angles += listOf(90.0, 90.0, 170.0, 170.0) }
        run(machine, angles)
        assertEquals(3, machine.reps)
    }

    // pose gaps and the hint (> 1.5 s)

    @Test
    fun shortGapKeepsCounting() {
        val machine = RepStateMachine(RepExercise.PUSHUPS)
        var hintSeen = false
        val angles = repeated(170.0, 3) + repeated(null, 10) + repeated(90.0, 3) + repeated(170.0, 3)
        angles.forEachIndexed { index, angle ->
            machine.process(PoseFrame(index * 0.1, angle))
            hintSeen = hintSeen || machine.showHint
        }
        assertEquals(1, machine.reps)
        assertFalse("1 s without the pose is not long enough for the hint", hintSeen)
    }

    @Test
    fun longGapShowsHintAndForgetsThePhase() {
        val machine = RepStateMachine(RepExercise.PUSHUPS)
        var time = run(machine, repeated(170.0, 3) + repeated(90.0, 3))
        time = run(machine, repeated(null, 20), from = time)
        assertTrue(machine.showHint)
        time = run(machine, repeated(170.0, 3), from = time)
        assertFalse(machine.showHint)
        assertEquals("no rep from a phase seen 2 s ago", 0, machine.reps)
        run(machine, repeated(90.0, 3) + repeated(170.0, 3), from = time)
        assertEquals(1, machine.reps)
    }

    @Test
    fun hintWhenNoPoseFromTheStart() {
        val machine = RepStateMachine(RepExercise.SQUATS)
        run(machine, repeated(null, 15)) // last frame at 1.4 s
        assertFalse(machine.showHint)
        machine.process(PoseFrame(1.7, null))
        assertTrue(machine.showHint)
    }

    // proximity — near → far is a rep; bounce < 0.4 s is dropped

    @Test
    fun proximityCountsNearToFar() {
        val counter = ProximityRepCounter()
        counter.process(0.0, true)
        assertTrue(counter.process(0.5, false))
        counter.process(1.0, true)
        counter.process(1.5, false)
        assertEquals(2, counter.reps)
    }

    @Test
    fun proximityBounceIsDropped() {
        val counter = ProximityRepCounter()
        counter.process(0.0, true)
        counter.process(0.5, false)
        counter.process(0.55, true)
        assertFalse("0.1 s after the last rep — sensor bounce", counter.process(0.6, false))
        counter.process(1.2, true)
        counter.process(1.6, false)
        assertEquals(2, counter.reps)
    }

    @Test
    fun proximityIgnoresRepeatedStates() {
        val counter = ProximityRepCounter()
        counter.process(0.0, false)
        counter.process(0.1, false)
        assertEquals(0, counter.reps)
        counter.process(0.5, true)
        counter.process(0.7, true)
        counter.process(1.2, false)
        assertEquals(1, counter.reps)
    }

    // geometry — joints → frame

    @Test
    fun angle() {
        val a = PosePoint(0.0, 1.0, 1.0)
        val b = PosePoint(0.0, 0.0, 1.0)
        assertEquals(90.0, PoseGeometry.angle(a, b, PosePoint(1.0, 0.0, 1.0)), 0.001)
        assertEquals(180.0, PoseGeometry.angle(a, b, PosePoint(0.0, -1.0, 1.0)), 0.001)
        assertEquals(45.0, PoseGeometry.angle(a, b, PosePoint(1.0, 1.0, 1.0)), 0.001)
    }

    @Test
    fun frameUsesTheMoreConfidentSideAndDropsWeakPoints() {
        val joints = mapOf(
            PoseJoint.LEFT_SHOULDER to PosePoint(0.0, 2.0, 0.55),
            PoseJoint.LEFT_ELBOW to PosePoint(0.0, 1.0, 0.55),
            PoseJoint.LEFT_WRIST to PosePoint(0.0, 0.0, 0.55),
            PoseJoint.RIGHT_SHOULDER to PosePoint(5.0, 1.0, 0.9),
            PoseJoint.RIGHT_ELBOW to PosePoint(5.0, 0.0, 0.9),
            PoseJoint.RIGHT_WRIST to PosePoint(6.0, 0.0, 0.9),
        )
        assertEquals(90.0, PoseFrame.from(joints, RepExercise.PUSHUPS, 1.0, yGrowsUp = false).angle!!, 0.001)

        val weak = joints + mapOf(
            PoseJoint.RIGHT_ELBOW to PosePoint(5.0, 0.0, 0.4),
            PoseJoint.LEFT_ELBOW to PosePoint(0.0, 1.0, 0.3),
        )
        assertNull(PoseFrame.from(weak, RepExercise.PUSHUPS, 1.0, yGrowsUp = false).angle)
    }

    @Test
    fun frameHeadAboveWristsInBothCoordinateSystems() {
        val arms = mapOf(
            PoseJoint.LEFT_SHOULDER to PosePoint(0.0, 5.0, 0.9),
            PoseJoint.LEFT_ELBOW to PosePoint(0.0, 6.0, 0.9),
            PoseJoint.LEFT_WRIST to PosePoint(0.0, 7.0, 0.9),
            PoseJoint.RIGHT_WRIST to PosePoint(2.0, 7.0, 0.9),
        )
        val withNose = arms + (PoseJoint.NOSE to PosePoint(1.0, 8.0, 0.9))
        // y down (ML Kit): nose at 8 is below wrists at 7; y up (Vision): above.
        assertEquals(false, PoseFrame.from(withNose, RepExercise.PULLUPS, 0.0, yGrowsUp = false).headAboveWrists)
        assertEquals(true, PoseFrame.from(withNose, RepExercise.PULLUPS, 0.0, yGrowsUp = true).headAboveWrists)
        assertNull(PoseFrame.from(arms, RepExercise.PULLUPS, 0.0, yGrowsUp = false).headAboveWrists)
    }
}
