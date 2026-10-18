import Foundation

// Rep counting algorithm (interfaces.md §7) — pure, no camera or UIKit here, so the XCTest target
// (ios/App/RepCounterTests) compiles this file on its own. The same algorithm lives in Kotlin
// (android/.../plugins/repcounter/RepStateMachine.kt); keep the two in step.

enum RepExercise: String {
    case pushups, squats, pullups
}

/// Body key points the counter looks at (Vision and ML Kit names map onto these).
enum PoseJoint: Hashable {
    case nose
    case leftShoulder, rightShoulder
    case leftElbow, rightElbow
    case leftWrist, rightWrist
    case leftHip, rightHip
    case leftKnee, rightKnee
    case leftAnkle, rightAnkle
}

struct PosePoint {
    let x: Double
    let y: Double
    let confidence: Double
}

enum PoseGeometry {
    static let minConfidence = 0.5

    /// Angle at `vertex` between the rays to `a` and `c`, in degrees (0…180).
    static func angle(_ a: PosePoint, vertex b: PosePoint, _ c: PosePoint) -> Double {
        let v1x = a.x - b.x, v1y = a.y - b.y
        let v2x = c.x - b.x, v2y = c.y - b.y
        let len = (v1x * v1x + v1y * v1y).squareRoot() * (v2x * v2x + v2y * v2y).squareRoot()
        guard len > 0 else { return 0 }
        let cosine = max(-1, min(1, (v1x * v2x + v1y * v2y) / len))
        return acos(cosine) * 180 / .pi
    }

    static func confident(_ point: PosePoint?) -> PosePoint? {
        guard let point, point.confidence >= minConfidence else { return nil }
        return point
    }
}

/// One analysed camera frame: the joint angle in degrees, `nil` when the key points were not found
/// with confidence ≥ 0.5; for pull-ups also whether the nose is above the line of the wrists.
struct PoseFrame {
    let time: Double
    let angle: Double?
    let headAboveWrists: Bool?

    init(time: Double, angle: Double?, headAboveWrists: Bool? = nil) {
        self.time = time
        self.angle = angle
        self.headAboveWrists = headAboveWrists
    }

    /// Key points → frame. Push-ups and pull-ups: elbow (shoulder–elbow–wrist); squats: knee
    /// (hip–knee–ankle); of the two sides the one whose weakest point is more confident.
    /// `yGrowsUp`: Vision's normalised coordinates grow upward, ML Kit's image pixels downward.
    static func from(joints: [PoseJoint: PosePoint], exercise: RepExercise, time: Double, yGrowsUp: Bool) -> PoseFrame {
        let sides: [(PoseJoint, PoseJoint, PoseJoint)] = exercise == .squats
            ? [(.leftHip, .leftKnee, .leftAnkle), (.rightHip, .rightKnee, .rightAnkle)]
            : [(.leftShoulder, .leftElbow, .leftWrist), (.rightShoulder, .rightElbow, .rightWrist)]
        var best: (confidence: Double, angle: Double)?
        for (first, middle, last) in sides {
            guard let a = PoseGeometry.confident(joints[first]),
                  let b = PoseGeometry.confident(joints[middle]),
                  let c = PoseGeometry.confident(joints[last]) else { continue }
            let confidence = min(a.confidence, b.confidence, c.confidence)
            if best == nil || confidence > best!.confidence {
                best = (confidence, PoseGeometry.angle(a, vertex: b, c))
            }
        }
        var head: Bool?
        if exercise == .pullups, let nose = PoseGeometry.confident(joints[.nose]) {
            let wrists = [joints[.leftWrist], joints[.rightWrist]].compactMap(PoseGeometry.confident)
            if !wrists.isEmpty {
                let line = wrists.map(\.y).reduce(0, +) / Double(wrists.count)
                head = yGrowsUp ? nose.y > line : nose.y < line
            }
        }
        return PoseFrame(time: time, angle: best?.angle, headAboveWrists: head)
    }
}

/// Counts reps from pose frames: median of the last 3 frames, hysteresis between the «down» and
/// «up» thresholds, a rep on the move down → up, not more often than once in 0.6 s; more than
/// 1.5 s without the pose → `showHint` («stand so the whole body is visible») and the phase is
/// forgotten (the person may have moved).
final class RepStateMachine {
    static let minRepInterval = 0.6
    static let poseLostHint = 1.5
    static let smoothingWindow = 3

    private enum Phase { case unknown, down, up }

    let exercise: RepExercise
    private(set) var reps = 0
    private(set) var showHint = false

    private var phase = Phase.unknown
    private var angles: [Double] = []
    private var heads: [Bool] = []
    private var lastPoseTime: Double?
    private var lastRepTime: Double?

    init(exercise: RepExercise) {
        self.exercise = exercise
    }

    private var downBelow: Double { 100 }
    private var upAbove: Double { exercise == .squats ? 160 : 150 }

    /// Feeds one frame; `true` when it completed a rep.
    @discardableResult
    func process(_ frame: PoseFrame) -> Bool {
        guard let angle = frame.angle, exercise != .pullups || frame.headAboveWrists != nil else {
            if lastPoseTime == nil { lastPoseTime = frame.time } // counting from the first frame
            if frame.time - (lastPoseTime ?? frame.time) > Self.poseLostHint, !showHint {
                showHint = true
                phase = .unknown
                angles.removeAll()
                heads.removeAll()
            }
            return false
        }
        lastPoseTime = frame.time
        showHint = false
        push(&angles, angle)
        if let head = frame.headAboveWrists { push(&heads, head) }

        let smoothed = Self.median(angles)
        let next: Phase?
        if exercise == .pullups {
            let headUp = heads.filter { $0 }.count * 2 > heads.count
            next = headUp ? .up : (smoothed > upAbove ? .down : nil)
        } else {
            next = smoothed < downBelow ? .down : (smoothed > upAbove ? .up : nil)
        }
        guard let next, next != phase else { return false }
        let wasDown = phase == .down
        phase = next
        guard wasDown, next == .up else { return false }
        if let last = lastRepTime, frame.time - last < Self.minRepInterval { return false }
        lastRepTime = frame.time
        reps += 1
        return true
    }

    private func push<T>(_ window: inout [T], _ value: T) {
        window.append(value)
        if window.count > Self.smoothingWindow { window.removeFirst(window.count - Self.smoothingWindow) }
    }

    static func median(_ values: [Double]) -> Double {
        let sorted = values.sorted()
        guard !sorted.isEmpty else { return 0 }
        let mid = sorted.count / 2
        return sorted.count % 2 == 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
    }
}

/// «Touch with the chest»: the proximity sensor going near → far is a rep; a far that comes less
/// than 0.4 s after the previous counted rep is sensor bounce and is dropped.
final class ProximityRepCounter {
    static let bounceInterval = 0.4

    private(set) var reps = 0
    private var near = false
    private var lastRepTime: Double?

    /// Feeds one sensor reading; `true` when it completed a rep.
    @discardableResult
    func process(time: Double, near isNear: Bool) -> Bool {
        guard isNear != near else { return false }
        near = isNear
        guard !isNear else { return false }
        if let last = lastRepTime, time - last < Self.bounceInterval { return false }
        lastRepTime = time
        reps += 1
        return true
    }
}
