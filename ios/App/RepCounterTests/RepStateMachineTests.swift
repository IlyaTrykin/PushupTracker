import XCTest

/// RepStateMachine / ProximityRepCounter / PoseGeometry (interfaces.md §7). Frames come at 10 fps
/// (0.1 s apart) unless a test sets the times itself; expected counts are worked out by hand.
final class RepStateMachineTests: XCTestCase {
    private func run(_ machine: RepStateMachine, angles: [Double?], from start: Double = 0) -> Double {
        for (index, angle) in angles.enumerated() {
            machine.process(PoseFrame(time: start + Double(index) * 0.1, angle: angle))
        }
        return start + Double(angles.count) * 0.1
    }

    private func repeated(_ value: Double?, _ count: Int) -> [Double?] {
        Array(repeating: value, count: count)
    }

    // MARK: push-ups — elbow: down < 100°, up > 150°

    func testPushupsCountOnDownToUp() {
        let machine = RepStateMachine(exercise: .pushups)
        _ = run(machine, angles: repeated(170, 3) + repeated(90, 3) + repeated(170, 3) + repeated(90, 3) + repeated(170, 3))
        XCTAssertEqual(machine.reps, 2)
    }

    func testPushupsStartingAtTheBottomDoNotCountTheFirstRise() {
        // Down first, then up: that is one rep (down → up), nothing before it.
        let machine = RepStateMachine(exercise: .pushups)
        _ = run(machine, angles: repeated(90, 3) + repeated(170, 3))
        XCTAssertEqual(machine.reps, 1)
    }

    func testPushupsHysteresis() {
        let shallow = RepStateMachine(exercise: .pushups)
        _ = run(shallow, angles: repeated(170, 3) + repeated(120, 3) + repeated(170, 3))
        XCTAssertEqual(shallow.reps, 0, "never below 100° — not a rep")

        let halfway = RepStateMachine(exercise: .pushups)
        _ = run(halfway, angles: repeated(170, 3) + repeated(95, 3) + repeated(140, 3) + repeated(95, 3))
        XCTAssertEqual(halfway.reps, 0, "140° is not above 150° — still down")
        _ = run(halfway, angles: repeated(155, 3), from: 1.2)
        XCTAssertEqual(halfway.reps, 1)
    }

    // MARK: squats — knee: down < 100°, up > 160°

    func testSquatsNeedFullStand() {
        let machine = RepStateMachine(exercise: .squats)
        var time = run(machine, angles: repeated(170, 3) + repeated(90, 3) + repeated(155, 3))
        XCTAssertEqual(machine.reps, 0, "155° is not above 160°")
        time = run(machine, angles: repeated(165, 3), from: time)
        XCTAssertEqual(machine.reps, 1)
        _ = run(machine, angles: repeated(85, 3) + repeated(170, 3), from: time)
        XCTAssertEqual(machine.reps, 2)
    }

    // MARK: pull-ups — up: nose above the wrists; down: elbow > 150°

    private func runPullups(_ machine: RepStateMachine, _ frames: [(Double, Bool)], from start: Double = 0) -> Double {
        var time = start
        for (angle, head) in frames {
            machine.process(PoseFrame(time: time, angle: angle, headAboveWrists: head))
            time += 0.1
        }
        return time
    }

    func testPullupsCountHangToChinOverBar() {
        let machine = RepStateMachine(exercise: .pullups)
        let hang = Array(repeating: (170.0, false), count: 4)
        let top = Array(repeating: (70.0, true), count: 4)
        _ = runPullups(machine, hang + top + hang + top)
        XCTAssertEqual(machine.reps, 2)
    }

    func testPullupsWithoutFullHangCountOnce() {
        let machine = RepStateMachine(exercise: .pullups)
        let hang = Array(repeating: (170.0, false), count: 4)
        let top = Array(repeating: (70.0, true), count: 4)
        let half = Array(repeating: (120.0, false), count: 4)
        _ = runPullups(machine, hang + top + half + top)
        XCTAssertEqual(machine.reps, 1, "elbow never straightened again — the second rise is not a rep")
    }

    func testPullupsNeedBothSignals() {
        // Head flag missing → the pose is not found, nothing changes.
        let machine = RepStateMachine(exercise: .pullups)
        var time = 0.0
        for _ in 0..<4 { machine.process(PoseFrame(time: time, angle: 170, headAboveWrists: false)); time += 0.1 }
        for _ in 0..<4 { machine.process(PoseFrame(time: time, angle: 70, headAboveWrists: nil)); time += 0.1 }
        XCTAssertEqual(machine.reps, 0)
    }

    // MARK: jitter (median of 3)

    func testSingleFrameJitterIsIgnored() {
        let dip = RepStateMachine(exercise: .pushups)
        _ = run(dip, angles: repeated(170, 4) + [90] + repeated(170, 4))
        XCTAssertEqual(dip.reps, 0, "one 90° frame is noise")

        let spike = RepStateMachine(exercise: .pushups)
        _ = run(spike, angles: repeated(170, 3) + repeated(90, 4) + [170] + repeated(90, 4) + repeated(170, 3))
        XCTAssertEqual(spike.reps, 1, "one 170° frame at the bottom is noise")
    }

    // MARK: rate — not more often than one rep in 0.6 s

    func testRepsFasterThanOnePerSixTenthsAreDropped() {
        // 2 frames down, 2 up: a rise every 0.4 s at 0.5, 0.9, 1.3, 1.7, 2.1, 2.5 s;
        // 0.9, 1.7 and 2.5 come 0.4 s after a counted one.
        let machine = RepStateMachine(exercise: .pushups)
        var angles: [Double?] = [170, 170]
        for _ in 0..<6 { angles += [90, 90, 170, 170] }
        _ = run(machine, angles: angles)
        XCTAssertEqual(machine.reps, 3)
    }

    // MARK: pose gaps and the «stand so the whole body is visible» hint (> 1.5 s)

    func testShortGapKeepsCounting() {
        let machine = RepStateMachine(exercise: .pushups)
        var hintSeen = false
        var time = 0.0
        for angle in repeated(170, 3) + repeated(nil, 10) + repeated(90, 3) + repeated(170, 3) {
            machine.process(PoseFrame(time: time, angle: angle))
            hintSeen = hintSeen || machine.showHint
            time += 0.1
        }
        XCTAssertEqual(machine.reps, 1)
        XCTAssertFalse(hintSeen, "1 s without the pose is not long enough for the hint")
    }

    func testLongGapShowsHintAndForgetsThePhase() {
        let machine = RepStateMachine(exercise: .pushups)
        var time = run(machine, angles: repeated(170, 3) + repeated(90, 3))
        time = run(machine, angles: repeated(nil, 20), from: time)
        XCTAssertTrue(machine.showHint)
        time = run(machine, angles: repeated(170, 3), from: time)
        XCTAssertFalse(machine.showHint, "pose found again — the hint goes away")
        XCTAssertEqual(machine.reps, 0, "the person may have moved: no rep from a phase seen 2 s ago")
        _ = run(machine, angles: repeated(90, 3) + repeated(170, 3), from: time)
        XCTAssertEqual(machine.reps, 1)
    }

    func testHintWhenNoPoseFromTheStart() {
        let machine = RepStateMachine(exercise: .squats)
        _ = run(machine, angles: repeated(nil, 15)) // last frame at 1.4 s
        XCTAssertFalse(machine.showHint)
        machine.process(PoseFrame(time: 1.7, angle: nil))
        XCTAssertTrue(machine.showHint)
    }

    // MARK: proximity — near → far is a rep; bounce < 0.4 s is dropped

    func testProximityCountsNearToFar() {
        let counter = ProximityRepCounter()
        counter.process(time: 0.0, near: true)
        XCTAssertTrue(counter.process(time: 0.5, near: false))
        counter.process(time: 1.0, near: true)
        counter.process(time: 1.5, near: false)
        XCTAssertEqual(counter.reps, 2)
    }

    func testProximityBounceIsDropped() {
        let counter = ProximityRepCounter()
        counter.process(time: 0.0, near: true)
        counter.process(time: 0.5, near: false)
        counter.process(time: 0.55, near: true)
        XCTAssertFalse(counter.process(time: 0.6, near: false), "0.1 s after the last rep — sensor bounce")
        counter.process(time: 1.2, near: true)
        counter.process(time: 1.6, near: false)
        XCTAssertEqual(counter.reps, 2)
    }

    func testProximityIgnoresRepeatedStates() {
        let counter = ProximityRepCounter()
        counter.process(time: 0.0, near: false)
        counter.process(time: 0.1, near: false)
        XCTAssertEqual(counter.reps, 0)
        counter.process(time: 0.5, near: true)
        counter.process(time: 0.7, near: true)
        counter.process(time: 1.2, near: false)
        XCTAssertEqual(counter.reps, 1)
    }

    // MARK: geometry — joints → frame

    func testAngle() {
        let a = PosePoint(x: 0, y: 1, confidence: 1)
        let b = PosePoint(x: 0, y: 0, confidence: 1)
        XCTAssertEqual(PoseGeometry.angle(a, vertex: b, PosePoint(x: 1, y: 0, confidence: 1)), 90, accuracy: 0.001)
        XCTAssertEqual(PoseGeometry.angle(a, vertex: b, PosePoint(x: 0, y: -1, confidence: 1)), 180, accuracy: 0.001)
        XCTAssertEqual(PoseGeometry.angle(a, vertex: b, PosePoint(x: 1, y: 1, confidence: 1)), 45, accuracy: 0.001)
    }

    func testFrameUsesTheMoreConfidentSideAndDropsWeakPoints() {
        let joints: [PoseJoint: PosePoint] = [
            // Left arm straight but barely seen; right arm bent at 90° and clearly seen.
            .leftShoulder: PosePoint(x: 0, y: 2, confidence: 0.55),
            .leftElbow: PosePoint(x: 0, y: 1, confidence: 0.55),
            .leftWrist: PosePoint(x: 0, y: 0, confidence: 0.55),
            .rightShoulder: PosePoint(x: 5, y: 1, confidence: 0.9),
            .rightElbow: PosePoint(x: 5, y: 0, confidence: 0.9),
            .rightWrist: PosePoint(x: 6, y: 0, confidence: 0.9)
        ]
        let frame = PoseFrame.from(joints: joints, exercise: .pushups, time: 1, yGrowsUp: true)
        XCTAssertEqual(frame.angle ?? -1, 90, accuracy: 0.001)

        var weak = joints
        weak[.rightElbow] = PosePoint(x: 5, y: 0, confidence: 0.4)
        weak[.leftElbow] = PosePoint(x: 0, y: 1, confidence: 0.3)
        XCTAssertNil(PoseFrame.from(joints: weak, exercise: .pushups, time: 1, yGrowsUp: true).angle)
    }

    func testFrameHeadAboveWristsInBothCoordinateSystems() {
        let arms: [PoseJoint: PosePoint] = [
            .leftShoulder: PosePoint(x: 0, y: 5, confidence: 0.9),
            .leftElbow: PosePoint(x: 0, y: 6, confidence: 0.9),
            .leftWrist: PosePoint(x: 0, y: 7, confidence: 0.9),
            .rightWrist: PosePoint(x: 2, y: 7, confidence: 0.9)
        ]
        var withNose = arms
        withNose[.nose] = PosePoint(x: 1, y: 8, confidence: 0.9)
        // y up (Vision): nose at 8 is above wrists at 7; y down (ML Kit): it is below.
        XCTAssertEqual(PoseFrame.from(joints: withNose, exercise: .pullups, time: 0, yGrowsUp: true).headAboveWrists, true)
        XCTAssertEqual(PoseFrame.from(joints: withNose, exercise: .pullups, time: 0, yGrowsUp: false).headAboveWrists, false)
        XCTAssertNil(PoseFrame.from(joints: arms, exercise: .pullups, time: 0, yGrowsUp: true).headAboveWrists)
    }
}
