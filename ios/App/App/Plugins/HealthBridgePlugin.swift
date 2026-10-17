import Foundation
import Capacitor
import HealthKit
import UIKit

/// Apple Health: workouts of the tracker as `HKWorkout` (HKWorkoutBuilder) with distance samples for
/// run / bike / row. Every record is tagged in its metadata with the workout's key and fingerprint,
/// so the app finds, rewrites and deletes only its own records.
/// JS (`src/lib/health/health.ts`): `isAvailable() → {available, reason?}`,
/// `requestPermissions() → {granted}`, `saveWorkout(HealthWorkoutInput) → {saved, skipped?}`,
/// `deleteWorkout({externalId}) → {deleted}`, `listOwn({since}) → {records: [{externalId, fingerprint}]}`,
/// `querySessions({since}) → {sessions: [HealthSession]}` (run / bike / row only), `openSettings()`.
@objc(HealthBridgePlugin)
public class HealthBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HealthBridgePlugin"
    public let jsName = "HealthBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveWorkout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteWorkout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listOwn", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "querySessions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise)
    ]

    static let externalIdKey = "pushup.externalId"
    static let fingerprintKey = "pushup.fingerprint"
    static let repsKey = "pushup.reps"
    static let exerciseKey = "pushup.exerciseType"

    private static let activities: [String: HKWorkoutActivityType] = [
        "running": .running,
        "cycling": .cycling,
        "rowing": .rowing,
        "coreTraining": .coreTraining,
        "jumpRope": .jumpRope,
        "traditionalStrengthTraining": .traditionalStrengthTraining,
        "functionalStrengthTraining": .functionalStrengthTraining
    ]

    private let store = HKHealthStore()
    /// Writes one at a time: a rewrite (delete + save) must not interleave with another for the same key.
    private let queue = DispatchQueue(label: "app.pushuptracker.mobile.health")

    /// Runs `work` on the serial queue and holds the queue until it calls `done`.
    private func serially(_ work: @escaping (_ done: @escaping () -> Void) -> Void) {
        queue.async {
            let semaphore = DispatchSemaphore(value: 0)
            work { semaphore.signal() }
            semaphore.wait()
        }
    }

    private static func distanceTypes() -> [HKQuantityType] {
        var types: [HKQuantityType] = [
            HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning)!,
            HKQuantityType.quantityType(forIdentifier: .distanceCycling)!
        ]
        if #available(iOS 18.0, *) {
            types.append(HKQuantityType.quantityType(forIdentifier: .distanceRowing)!)
        }
        return types
    }

    private static func distanceType(for activity: HKWorkoutActivityType) -> HKQuantityType? {
        switch activity {
        case .running: return HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning)
        case .cycling: return HKQuantityType.quantityType(forIdentifier: .distanceCycling)
        case .rowing:
            if #available(iOS 18.0, *) { return HKQuantityType.quantityType(forIdentifier: .distanceRowing) }
            return nil
        default: return nil
        }
    }

    private static func sampleTypes() -> Set<HKSampleType> {
        var types: Set<HKSampleType> = [HKObjectType.workoutType()]
        for type in distanceTypes() { types.insert(type) }
        return types
    }

    private static let isoFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let isoFormatterNoFraction = ISO8601DateFormatter()

    static func parseDate(_ value: String?) -> Date? {
        guard let value = value else { return nil }
        return isoFormatter.date(from: value) ?? isoFormatterNoFraction.date(from: value)
    }

    private func notAuthorized() -> Bool {
        return store.authorizationStatus(for: HKObjectType.workoutType()) != .sharingAuthorized
    }

    // MARK: - JS methods

    @objc func isAvailable(_ call: CAPPluginCall) {
        if HKHealthStore.isHealthDataAvailable() {
            call.resolve(["available": true])
        } else {
            call.resolve(["available": false, "reason": "not_supported"])
        }
    }

    @objc override public func requestPermissions(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["granted": false])
            return
        }
        let types = HealthBridgePlugin.sampleTypes()
        store.requestAuthorization(toShare: types, read: Set(types.map { $0 as HKObjectType })) { [weak self] _, _ in
            guard let self = self else { return }
            call.resolve(["granted": !self.notAuthorized()])
        }
    }

    @objc func saveWorkout(_ call: CAPPluginCall) {
        guard let externalId = call.getString("externalId"), !externalId.isEmpty,
              let fingerprint = call.getString("fingerprint"),
              let start = HealthBridgePlugin.parseDate(call.getString("start")),
              let end = HealthBridgePlugin.parseDate(call.getString("end")), end >= start else {
            call.reject("externalId, fingerprint, start and end are required", "invalid_request")
            return
        }
        guard !notAuthorized() else {
            call.reject("No permission to save workouts", "not_authorized")
            return
        }
        let activity = HealthBridgePlugin.activities[call.getString("activity") ?? ""] ?? .functionalStrengthTraining
        var metadata: [String: Any] = [
            HealthBridgePlugin.externalIdKey: externalId,
            HealthBridgePlugin.fingerprintKey: fingerprint,
            HKMetadataKeyIndoorWorkout: !(activity == .running || activity == .cycling)
        ]
        if let exerciseType = call.getString("exerciseType") { metadata[HealthBridgePlugin.exerciseKey] = exerciseType }
        if let reps = call.getInt("reps") { metadata[HealthBridgePlugin.repsKey] = reps }
        let distance = call.getDouble("distanceMeters")

        serially { done in
            self.findOwnWorkouts(externalId: externalId) { existing in
                if existing.count == 1, existing[0].metadata?[HealthBridgePlugin.fingerprintKey] as? String == fingerprint {
                    call.resolve(["saved": false, "skipped": "exists"])
                    done()
                    return
                }
                self.deleteOwn(externalId: externalId, workouts: existing) { _ in
                    self.build(activity: activity, start: start, end: end, distance: distance, metadata: metadata) { error in
                        if let error = error {
                            call.reject("Could not save the workout: \(error.localizedDescription)", "save_failed")
                        } else {
                            call.resolve(["saved": true])
                        }
                        done()
                    }
                }
            }
        }
    }

    @objc func deleteWorkout(_ call: CAPPluginCall) {
        guard let externalId = call.getString("externalId"), !externalId.isEmpty else {
            call.reject("externalId is required", "invalid_request")
            return
        }
        serially { done in
            self.findOwnWorkouts(externalId: externalId) { existing in
                self.deleteOwn(externalId: externalId, workouts: existing) { deleted in
                    call.resolve(["deleted": deleted])
                    done()
                }
            }
        }
    }

    @objc func listOwn(_ call: CAPPluginCall) {
        let since = HealthBridgePlugin.parseDate(call.getString("since")) ?? Date(timeIntervalSince1970: 0)
        let predicate = NSCompoundPredicate(andPredicateWithSubpredicates: [
            HKQuery.predicateForObjects(from: HKSource.default()),
            HKQuery.predicateForSamples(withStart: since, end: nil, options: []),
            HKQuery.predicateForObjects(withMetadataKey: HealthBridgePlugin.externalIdKey)
        ])
        let query = HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, error in
            if let error = error {
                call.reject("Could not read Health: \(error.localizedDescription)", "read_failed")
                return
            }
            let records: [[String: String]] = (samples ?? []).compactMap { sample in
                guard let externalId = sample.metadata?[HealthBridgePlugin.externalIdKey] as? String else { return nil }
                let fingerprint = sample.metadata?[HealthBridgePlugin.fingerprintKey] as? String ?? ""
                return ["externalId": externalId, "fingerprint": fingerprint]
            }
            call.resolve(["records": records])
        }
        store.execute(query)
    }

    /// Runs, rides and rows since `since` (any app and device), newest first, for the import screen.
    /// `fromThisApp` marks the records PushupTracker wrote itself. Distance in metres, null when the
    /// record has none. HealthKit never says whether *reading* was denied (it just returns nothing);
    /// an explicit refusal of writing workouts is taken as «no permission».
    @objc func querySessions(_ call: CAPPluginCall) {
        guard let since = HealthBridgePlugin.parseDate(call.getString("since")) else {
            call.reject("since is required", "invalid_request")
            return
        }
        if store.authorizationStatus(for: HKObjectType.workoutType()) == .sharingDenied {
            call.reject("No permission to read workouts", "not_authorized")
            return
        }
        let activities: [(HKWorkoutActivityType, String)] = [(.running, "run"), (.cycling, "bike"), (.rowing, "row")]
        let predicate = NSCompoundPredicate(andPredicateWithSubpredicates: [
            HKQuery.predicateForSamples(withStart: since, end: nil, options: []),
            NSCompoundPredicate(orPredicateWithSubpredicates: activities.map { HKQuery.predicateForWorkouts(with: $0.0) })
        ])
        let newestFirst = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)
        let query = HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: [newestFirst]) { _, samples, error in
            if let error = error {
                call.reject("Could not read Health: \(error.localizedDescription)", "read_failed")
                return
            }
            let ownBundle = Bundle.main.bundleIdentifier
            let formatter = HealthBridgePlugin.isoFormatter
            let sessions: [[String: Any]] = ((samples as? [HKWorkout]) ?? []).compactMap { workout in
                guard let activity = activities.first(where: { $0.0 == workout.workoutActivityType })?.1 else { return nil }
                let source = workout.sourceRevision.source
                let own = source.bundleIdentifier == ownBundle || workout.metadata?[HealthBridgePlugin.externalIdKey] != nil
                var session: [String: Any] = [
                    "id": workout.uuid.uuidString,
                    "platform": "apple_health",
                    "activity": activity,
                    "start": formatter.string(from: workout.startDate),
                    "end": formatter.string(from: workout.endDate),
                    "sourceName": source.name,
                    "fromThisApp": own
                ]
                if let meters = HealthBridgePlugin.distanceMeters(of: workout) { session["distanceMeters"] = meters }
                return session
            }
            call.resolve(["sessions": sessions])
        }
        store.execute(query)
    }

    /// Total distance of a workout in metres: the distance statistics (iOS 16+), else the workout's own total.
    private static func distanceMeters(of workout: HKWorkout) -> Double? {
        if #available(iOS 16.0, *) {
            for type in distanceTypes() {
                if let meters = workout.statistics(for: type)?.sumQuantity()?.doubleValue(for: .meter()), meters > 0 { return meters }
            }
        }
        return workout.totalDistance?.doubleValue(for: .meter())
    }

    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            // The app's page in Settings lists «Health» with its permissions.
            if let url = URL(string: UIApplication.openSettingsURLString) {
                UIApplication.shared.open(url)
            }
            call.resolve()
        }
    }

    // MARK: - HealthKit

    private func ownPredicate(externalId: String) -> NSPredicate {
        return NSCompoundPredicate(andPredicateWithSubpredicates: [
            HKQuery.predicateForObjects(from: HKSource.default()),
            HKQuery.predicateForObjects(withMetadataKey: HealthBridgePlugin.externalIdKey, allowedValues: [externalId])
        ])
    }

    private func findOwnWorkouts(externalId: String, completion: @escaping ([HKWorkout]) -> Void) {
        let query = HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: ownPredicate(externalId: externalId), limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, _ in
            completion((samples as? [HKWorkout]) ?? [])
        }
        store.execute(query)
    }

    /// Deletes the workouts and their distance samples (tagged with the same key).
    private func deleteOwn(externalId: String, workouts: [HKWorkout], completion: @escaping (Bool) -> Void) {
        let group = DispatchGroup()
        var deletedAny = false
        let lock = NSLock()
        if !workouts.isEmpty {
            group.enter()
            store.delete(workouts) { ok, _ in
                lock.lock(); if ok { deletedAny = true }; lock.unlock()
                group.leave()
            }
        }
        for type in HealthBridgePlugin.distanceTypes() {
            group.enter()
            store.deleteObjects(of: type, predicate: ownPredicate(externalId: externalId)) { _, _, _ in
                group.leave()
            }
        }
        group.notify(queue: .global(qos: .userInitiated)) { completion(deletedAny) }
    }

    private func build(activity: HKWorkoutActivityType, start: Date, end: Date, distance: Double?, metadata: [String: Any], completion: @escaping (Error?) -> Void) {
        let configuration = HKWorkoutConfiguration()
        configuration.activityType = activity
        let builder = HKWorkoutBuilder(healthStore: store, configuration: configuration, device: .local())
        builder.beginCollection(withStart: start) { ok, error in
            guard ok else { completion(error); return }
            builder.addMetadata(metadata) { ok, error in
                guard ok else { completion(error); return }
                self.addDistance(builder: builder, activity: activity, start: start, end: end, distance: distance, metadata: metadata) { error in
                    if let error = error { completion(error); return }
                    builder.endCollection(withEnd: end) { ok, error in
                        guard ok else { completion(error); return }
                        builder.finishWorkout { workout, error in
                            completion(workout == nil ? (error ?? NSError(domain: "HealthBridge", code: 1)) : nil)
                        }
                    }
                }
            }
        }
    }

    private func addDistance(builder: HKWorkoutBuilder, activity: HKWorkoutActivityType, start: Date, end: Date, distance: Double?, metadata: [String: Any], completion: @escaping (Error?) -> Void) {
        guard let meters = distance, meters > 0, let type = HealthBridgePlugin.distanceType(for: activity) else {
            completion(nil)
            return
        }
        // Only the key: the sample is found and deleted together with its workout.
        let sampleMetadata: [String: Any] = [HealthBridgePlugin.externalIdKey: metadata[HealthBridgePlugin.externalIdKey] ?? ""]
        let sample = HKQuantitySample(type: type, quantity: HKQuantity(unit: .meter(), doubleValue: meters), start: start, end: end, metadata: sampleMetadata)
        builder.add([sample]) { ok, error in
            completion(ok ? nil : error)
        }
    }
}
