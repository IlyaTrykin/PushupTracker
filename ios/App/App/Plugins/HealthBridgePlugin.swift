import Foundation
import Capacitor
import HealthKit
import UIKit

/// Apple Health: workouts of the tracker as `HKWorkout` (HKWorkoutBuilder) with distance samples for
/// run / bike / row and an `activeEnergyBurned` sample (active kcal: fills the Move ring) when the
/// workout has calories and writing energy is allowed. Every record is tagged in its metadata with the workout's key and fingerprint,
/// so the app finds, rewrites and deletes only its own records. `pushup.owner` — the short tag of the
/// tracker account the record belongs to: with an owner given, records of another account on this
/// phone are never touched (records without an owner, from an older version, count as the caller's).
/// JS (`src/lib/health/health.ts`): `isAvailable() → {available, reason?}`,
/// `requestPermissions() → {granted}`, `saveWorkout(HealthWorkoutInput) → {saved, skipped?}`,
/// `deleteWorkout({externalId, owner?}) → {deleted}`, `listOwn({since}) → {records: [{externalId, fingerprint, owner?}]}`,
/// `querySessions({since}) → {sessions: [HealthSession]}` (run / bike / row only), `openSettings()`,
/// `readBodyMetrics() → {weightKg?, weightMeasuredAt?, heightCm?, heightMeasuredAt?, birthDate?, sex?}`
/// (latest samples; HealthKit never says that reading was denied — then the fields are just missing).
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
        CAPPluginMethod(name: "readBodyMetrics", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise)
    ]

    static let externalIdKey = "pushup.externalId"
    static let fingerprintKey = "pushup.fingerprint"
    static let repsKey = "pushup.reps"
    static let exerciseKey = "pushup.exerciseType"
    static let ownerKey = "pushup.owner"

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

    /// Active energy of a workout (kcal): counted by the Move ring.
    private static let energyType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)!

    /// Samples the app writes (and reads back to find its own records).
    private static func sampleTypes() -> Set<HKSampleType> {
        var types: Set<HKSampleType> = [HKObjectType.workoutType(), energyType]
        for type in distanceTypes() { types.insert(type) }
        return types
    }

    /// Read-only: weight, height, date of birth and sex — for the calories of the workouts.
    private static func bodyReadTypes() -> Set<HKObjectType> {
        return [
            HKQuantityType.quantityType(forIdentifier: .bodyMass)!,
            HKQuantityType.quantityType(forIdentifier: .height)!,
            HKCharacteristicType.characteristicType(forIdentifier: .dateOfBirth)!,
            HKCharacteristicType.characteristicType(forIdentifier: .biologicalSex)!
        ]
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

    /// The account's tag from the call; nil — no owner given (an older JS): every record of the key counts.
    private static func owner(of call: CAPPluginCall) -> String? {
        guard let owner = call.getString("owner"), !owner.isEmpty else { return nil }
        return owner
    }

    /// Records of `owner` and records without an owner; all of them when no owner is given.
    static func mineOrUnowned<T: HKSample>(_ samples: [T], owner: String?) -> [T] {
        guard let owner = owner else { return samples }
        return samples.filter { sample in
            guard let tag = sample.metadata?[ownerKey] as? String else { return true }
            return tag == owner
        }
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
        let read = Set(types.map { $0 as HKObjectType }).union(HealthBridgePlugin.bodyReadTypes())
        // The system sheet appears only while some of these types were never asked about.
        store.requestAuthorization(toShare: types, read: read) { [weak self] _, _ in
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
        let owner = HealthBridgePlugin.owner(of: call)
        var metadata: [String: Any] = [
            HealthBridgePlugin.externalIdKey: externalId,
            HealthBridgePlugin.fingerprintKey: fingerprint,
            HKMetadataKeyIndoorWorkout: !(activity == .running || activity == .cycling)
        ]
        if let exerciseType = call.getString("exerciseType") { metadata[HealthBridgePlugin.exerciseKey] = exerciseType }
        if let reps = call.getInt("reps") { metadata[HealthBridgePlugin.repsKey] = reps }
        if let owner = owner { metadata[HealthBridgePlugin.ownerKey] = owner }
        let distance = call.getDouble("distanceMeters")
        // Без разрешения на энергию тренировка пишется без неё (отказ ничего не ломает).
        let energyAllowed = store.authorizationStatus(for: HealthBridgePlugin.energyType) == .sharingAuthorized
        let kcal = energyAllowed ? call.getDouble("activeKcal") : nil

        serially { done in
            self.findOwnWorkouts(externalId: externalId, owner: owner) { existing in
                // Same key, fingerprint and owner — already there. A record without an owner is
                // rewritten once to carry it.
                if existing.count == 1,
                   existing[0].metadata?[HealthBridgePlugin.fingerprintKey] as? String == fingerprint,
                   existing[0].metadata?[HealthBridgePlugin.ownerKey] as? String == owner {
                    call.resolve(["saved": false, "skipped": "exists"])
                    done()
                    return
                }
                self.deleteOwn(externalId: externalId, owner: owner, workouts: existing) { _ in
                    self.build(activity: activity, start: start, end: end, distance: distance, kcal: kcal, metadata: metadata) { error in
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
        let owner = HealthBridgePlugin.owner(of: call)
        serially { done in
            self.findOwnWorkouts(externalId: externalId, owner: owner) { existing in
                self.deleteOwn(externalId: externalId, owner: owner, workouts: existing) { deleted in
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
                var record = ["externalId": externalId, "fingerprint": fingerprint]
                if let owner = sample.metadata?[HealthBridgePlugin.ownerKey] as? String { record["owner"] = owner }
                return record
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

    /// Latest weight (kg) and height (cm) with the moments they were measured, date of birth
    /// (`YYYY-MM-DD`) and sex (`male` / `female` / `other`). Nothing allowed or nothing there — no field.
    @objc func readBodyMetrics(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve([:])
            return
        }
        var result: [String: Any] = [:]
        let lock = NSLock()
        let group = DispatchGroup()
        let formatter = HealthBridgePlugin.isoFormatter
        let quantities: [(HKQuantityTypeIdentifier, HKUnit, String, String)] = [
            (.bodyMass, HKUnit.gramUnit(with: .kilo), "weightKg", "weightMeasuredAt"),
            (.height, HKUnit.meterUnit(with: .centi), "heightCm", "heightMeasuredAt")
        ]
        for (identifier, unit, valueKey, dateKey) in quantities {
            guard let type = HKQuantityType.quantityType(forIdentifier: identifier) else { continue }
            group.enter()
            let newestFirst = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)
            let query = HKSampleQuery(sampleType: type, predicate: nil, limit: 1, sortDescriptors: [newestFirst]) { _, samples, _ in
                if let sample = (samples as? [HKQuantitySample])?.first {
                    lock.lock()
                    result[valueKey] = sample.quantity.doubleValue(for: unit)
                    result[dateKey] = formatter.string(from: sample.endDate)
                    lock.unlock()
                }
                group.leave()
            }
            store.execute(query)
        }
        if let birth = try? store.dateOfBirthComponents(), let year = birth.year, let month = birth.month, let day = birth.day {
            result["birthDate"] = String(format: "%04d-%02d-%02d", year, month, day)
        }
        if let sex = try? store.biologicalSex().biologicalSex {
            switch sex {
            case .male: result["sex"] = "male"
            case .female: result["sex"] = "female"
            case .other: result["sex"] = "other"
            default: break
            }
        }
        group.notify(queue: .global(qos: .userInitiated)) {
            lock.lock()
            let metrics = result
            lock.unlock()
            call.resolve(metrics)
        }
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

    /// The app's workouts with this key of `owner` (and without an owner); another account's stay out.
    private func findOwnWorkouts(externalId: String, owner: String?, completion: @escaping ([HKWorkout]) -> Void) {
        let query = HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: ownPredicate(externalId: externalId), limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, _ in
            completion(HealthBridgePlugin.mineOrUnowned((samples as? [HKWorkout]) ?? [], owner: owner))
        }
        store.execute(query)
    }

    /// Deletes the workouts and their distance and energy samples (tagged with the same key and owner).
    private func deleteOwn(externalId: String, owner: String?, workouts: [HKWorkout], completion: @escaping (Bool) -> Void) {
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
        for type in HealthBridgePlugin.distanceTypes() + [HealthBridgePlugin.energyType] {
            group.enter()
            // Read, then delete what belongs to this owner: another account's sample keeps its distance.
            let query = HKSampleQuery(sampleType: type, predicate: ownPredicate(externalId: externalId), limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, _ in
                let mine = HealthBridgePlugin.mineOrUnowned(samples ?? [], owner: owner)
                guard !mine.isEmpty else { group.leave(); return }
                self.store.delete(mine) { _, _ in group.leave() }
            }
            store.execute(query)
        }
        group.notify(queue: .global(qos: .userInitiated)) { completion(deletedAny) }
    }

    private func build(activity: HKWorkoutActivityType, start: Date, end: Date, distance: Double?, kcal: Double?, metadata: [String: Any], completion: @escaping (Error?) -> Void) {
        let configuration = HKWorkoutConfiguration()
        configuration.activityType = activity
        let builder = HKWorkoutBuilder(healthStore: store, configuration: configuration, device: .local())
        builder.beginCollection(withStart: start) { ok, error in
            guard ok else { completion(error); return }
            builder.addMetadata(metadata) { ok, error in
                guard ok else { completion(error); return }
                self.addDistance(builder: builder, activity: activity, start: start, end: end, distance: distance, metadata: metadata) { error in
                    if let error = error { completion(error); return }
                    self.addEnergy(builder: builder, start: start, end: end, kcal: kcal, metadata: metadata) { error in
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
    }

    /// Active energy of the workout (kcal) as one sample over its time: the Move ring counts it.
    private func addEnergy(builder: HKWorkoutBuilder, start: Date, end: Date, kcal: Double?, metadata: [String: Any], completion: @escaping (Error?) -> Void) {
        guard let kcal = kcal, kcal > 0 else {
            completion(nil)
            return
        }
        var sampleMetadata: [String: Any] = [HealthBridgePlugin.externalIdKey: metadata[HealthBridgePlugin.externalIdKey] ?? ""]
        if let owner = metadata[HealthBridgePlugin.ownerKey] { sampleMetadata[HealthBridgePlugin.ownerKey] = owner }
        let sample = HKQuantitySample(type: HealthBridgePlugin.energyType, quantity: HKQuantity(unit: .kilocalorie(), doubleValue: kcal), start: start, end: end, metadata: sampleMetadata)
        builder.add([sample]) { ok, error in
            completion(ok ? nil : error)
        }
    }

    private func addDistance(builder: HKWorkoutBuilder, activity: HKWorkoutActivityType, start: Date, end: Date, distance: Double?, metadata: [String: Any], completion: @escaping (Error?) -> Void) {
        guard let meters = distance, meters > 0, let type = HealthBridgePlugin.distanceType(for: activity) else {
            completion(nil)
            return
        }
        // Only the key and the owner: the sample is found and deleted together with its workout.
        var sampleMetadata: [String: Any] = [HealthBridgePlugin.externalIdKey: metadata[HealthBridgePlugin.externalIdKey] ?? ""]
        if let owner = metadata[HealthBridgePlugin.ownerKey] { sampleMetadata[HealthBridgePlugin.ownerKey] = owner }
        let sample = HKQuantitySample(type: type, quantity: HKQuantity(unit: .meter(), doubleValue: meters), start: start, end: end, metadata: sampleMetadata)
        builder.add([sample]) { ok, error in
            completion(ok ? nil : error)
        }
    }
}
