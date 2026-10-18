import Foundation

/// Фоновая отправка тренировок из очереди: фоновая `URLSession` (её ведёт система, а не приложение),
/// поэтому запрос уходит, даже когда приложение свёрнуто или выгружено, как только есть связь
/// и сервер отвечает. Повтор безопасен: в теле постоянный `clientRequestId`, сервер на повтор
/// возвращает уже созданную запись.
///
/// Записи (`id` = `clientRequestId`) и тела запросов лежат в Application Support/BackgroundUpload.
/// В записях `queued` есть заголовок Authorization, поэтому каталог исключён из резервных копий
/// (iCloud / компьютер), а у записей `done` / `failed` заголовки стираются сразу.
/// Состояния: `queued` (ждёт или отправляется), `done` (2xx), `failed` (4xx, 401 — ждём входа).
/// Сетевая ошибка, 408, 429 и 5xx — новая попытка с паузой (429 — по Retry-After).
final class BackgroundUploadManager: NSObject, URLSessionDataDelegate {
    static let shared = BackgroundUploadManager()
    static let sessionIdentifier = "app.pushuptracker.mobile.background-upload"

    struct Record: Codable {
        let id: String
        let url: String
        var headers: [String: String]
        var state: String
        var httpStatus: Int?
        var attempts: Int
    }

    private static let backoffSeconds: [Double] = [15, 60, 300, 900]

    private let lock = NSLock()
    private var records: [String: Record] = [:]
    private var eventsCompletionHandler: (() -> Void)?
    private let directory: URL
    private let recordsFile: URL

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: Self.sessionIdentifier)
        config.sessionSendsLaunchEvents = true
        config.isDiscretionary = false
        config.timeoutIntervalForRequest = 60
        config.timeoutIntervalForResource = 7 * 24 * 3600
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        return URLSession(configuration: config, delegate: self, delegateQueue: queue)
    }()

    private override init() {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        directory = support.appendingPathComponent("BackgroundUpload", isDirectory: true)
        recordsFile = directory.appendingPathComponent("records.json")
        super.init()
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        Self.excludeFromBackup(directory)
        if let data = try? Data(contentsOf: recordsFile),
           let saved = try? JSONDecoder().decode([String: Record].self, from: data) {
            records = saved
        }
    }

    /// Токен сессии в заголовках не должен попасть в бэкап и восстановиться на другом устройстве.
    private static func excludeFromBackup(_ url: URL) {
        var target = url
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? target.setResourceValues(values)
    }

    /// При запуске (в том числе фоновом, по событию сессии) — переподключиться к фоновой сессии.
    func activate() {
        _ = session
    }

    /// `application(_:handleEventsForBackgroundURLSession:completionHandler:)`.
    func handleEvents(completionHandler: @escaping () -> Void) {
        lock.lock()
        eventsCompletionHandler = completionHandler
        lock.unlock()
        activate()
    }

    // MARK: - API плагина

    func enqueue(id: String, url: URL, headers: [String: String], body: Data, delaySeconds: Double, completion: @escaping (Bool) -> Void) {
        lock.lock()
        if let existing = records[id], existing.state == "queued" || existing.state == "done" {
            // Уже ждёт отправки или уже на сервере: второй копии не нужно.
            lock.unlock()
            completion(existing.state == "queued")
            return
        }
        do {
            try body.write(to: bodyFile(id), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch {
            lock.unlock()
            completion(false)
            return
        }
        let record = Record(id: id, url: url.absoluteString, headers: headers, state: "queued", httpStatus: nil, attempts: 0)
        records[id] = record
        persist()
        lock.unlock()
        startTask(record, delaySeconds: delaySeconds)
        completion(true)
    }

    /// `true` — копия снята (ещё не начинала отправку или не была принята сервером);
    /// `false` — уже отправляется, уже на сервере или её нет.
    func cancel(id: String, completion: @escaping (Bool) -> Void) {
        lock.lock()
        guard let record = records[id] else {
            lock.unlock()
            completion(false)
            return
        }
        switch record.state {
        case "done":
            removeRecord(id)
            lock.unlock()
            completion(false)
            return
        case "failed":
            removeRecord(id)
            lock.unlock()
            // Была повторная попытка — более ранняя могла дойти до сервера, а ответ потеряться.
            completion(record.attempts == 0)
            return
        default:
            lock.unlock()
        }
        session.getAllTasks { tasks in
            let own = tasks.filter { $0.taskDescription == id && $0.state != .completed }
            // Нет живой задачи — ответ сервера мог уже прийти и ждёт обработки: считаем отправленной.
            // Была хотя бы одна попытка — запрос мог дойти до сервера без ответа: тоже отправленной.
            let started = own.isEmpty || record.attempts > 0 || own.contains { $0.countOfBytesSent > 0 }
            if started {
                completion(false)
                return
            }
            self.lock.lock()
            self.removeRecord(id)
            self.lock.unlock()
            own.forEach { $0.cancel() }
            // Повтор, созданный в этот момент делегатом, тоже снимается (он ещё ждёт своей паузы).
            self.session.getAllTasks { later in
                later.filter { $0.taskDescription == id }.forEach { $0.cancel() }
                completion(true)
            }
        }
    }

    func list(completion: @escaping ([[String: Any]]) -> Void) {
        lock.lock()
        let snapshot = Array(records.values)
        lock.unlock()
        session.getAllTasks { tasks in
            let sending = Set(tasks.filter { $0.countOfBytesSent > 0 && $0.state == .running }.compactMap { $0.taskDescription })
            let items: [[String: Any]] = snapshot.map { record in
                var item: [String: Any] = ["id": record.id, "state": record.state]
                if record.state == "queued" && sending.contains(record.id) { item["state"] = "running" }
                if let status = record.httpStatus { item["httpStatus"] = status }
                return item
            }
            completion(items)
        }
    }

    // MARK: - Задачи

    private func bodyFile(_ id: String) -> URL {
        let name = id.unicodeScalars.map { String(format: "%04x", $0.value) }.joined()
        return directory.appendingPathComponent("\(name).json")
    }

    /// Под `lock`.
    private func removeRecord(_ id: String) {
        records.removeValue(forKey: id)
        try? FileManager.default.removeItem(at: bodyFile(id))
        persist()
    }

    /// Под `lock`.
    private func persist() {
        guard let data = try? JSONEncoder().encode(records) else { return }
        try? data.write(to: recordsFile, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    private func startTask(_ record: Record, delaySeconds: Double) {
        guard let url = URL(string: record.url) else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        for (name, value) in record.headers {
            request.setValue(value, forHTTPHeaderField: name)
        }
        let file = bodyFile(record.id)
        let task = session.uploadTask(with: request, fromFile: file)
        task.taskDescription = record.id
        if delaySeconds > 0 {
            task.earliestBeginDate = Date().addingTimeInterval(delaySeconds)
        }
        let size = (try? FileManager.default.attributesOfItem(atPath: file.path))?[.size] as? Int64
        task.countOfBytesClientExpectsToSend = (size ?? 1024) + 2048
        task.countOfBytesClientExpectsToReceive = 8192
        task.resume()
    }

    private static func retryAfterSeconds(_ response: HTTPURLResponse) -> Double? {
        guard let raw = response.value(forHTTPHeaderField: "Retry-After"), let seconds = Double(raw.trimmingCharacters(in: .whitespaces)), seconds > 0 else {
            return nil
        }
        return seconds
    }

    // MARK: - URLSessionDelegate

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let id = task.taskDescription else { return }
        let cancelled = (error as NSError?).map { $0.domain == NSURLErrorDomain && $0.code == NSURLErrorCancelled } ?? false
        lock.lock()
        // Свой `cancel` сначала удаляет запись, потом снимает задачу: записи нет — снята нами.
        guard var record = records[id], record.state == "queued" else {
            lock.unlock()
            return
        }
        let response = task.response as? HTTPURLResponse
        var retryDelay: Double?
        if cancelled {
            // Запись есть и ждёт, а задачу снял не `cancel`: система (приложение закрыли смахиванием,
            // сессию сбросили). Задача ставится заново; если байты успели уйти — это попытка.
            if task.countOfBytesSent > 0 { record.attempts += 1 }
            retryDelay = Self.backoffSeconds[0]
        } else if error == nil, let response = response {
            record.httpStatus = response.statusCode
            switch response.statusCode {
            case 200..<300:
                record.state = "done"
            case 408, 429, 500...:
                record.attempts += 1
                let step = Self.backoffSeconds[min(record.attempts, Self.backoffSeconds.count) - 1]
                retryDelay = response.statusCode == 429 ? (Self.retryAfterSeconds(response) ?? step) : step
            default:
                record.state = "failed" // 4xx (в т.ч. 401): JS получит тот же ответ сам
            }
        } else {
            record.attempts += 1
            retryDelay = Self.backoffSeconds[min(record.attempts, Self.backoffSeconds.count) - 1]
        }
        if record.state != "queued" {
            record.headers = [:] // Authorization больше не нужен
            try? FileManager.default.removeItem(at: bodyFile(id))
        }
        records[id] = record
        persist()
        lock.unlock()
        if let delay = retryDelay {
            startTask(record, delaySeconds: delay)
        }
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        lock.lock()
        let handler = eventsCompletionHandler
        eventsCompletionHandler = nil
        lock.unlock()
        if let handler = handler {
            DispatchQueue.main.async(execute: handler)
        }
    }
}
