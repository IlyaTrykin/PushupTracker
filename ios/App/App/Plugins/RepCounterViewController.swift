import AVFoundation
import UIKit
import Vision

/// Full-screen rep counter (interfaces.md §7): camera preview with body pose (Vision
/// `VNDetectHumanBodyPoseRequest`) or a dark screen for the proximity sensor; a big counter, a
/// short sound and a tap on every counted rep, the hint «stand so the whole body is visible» when
/// the pose is lost for more than 1.5 s, «Готово» / «Отмена». Counting itself is `RepStateMachine`
/// / `ProximityRepCounter`.
final class RepCounterViewController: UIViewController, AVCaptureVideoDataOutputSampleBufferDelegate {
    enum Mode {
        case camera
        /// The device has no camera (the iOS simulator): the screen only explains it.
        case noCamera
        case proximity
    }

    /// Front camera (the phone faces the person), any camera otherwise.
    static func captureDevice() -> AVCaptureDevice? {
        AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front)
            ?? AVCaptureDevice.default(for: .video)
    }

    private static let jointNames: [VNHumanBodyPoseObservation.JointName: PoseJoint] = [
        .nose: .nose,
        .leftShoulder: .leftShoulder, .rightShoulder: .rightShoulder,
        .leftElbow: .leftElbow, .rightElbow: .rightElbow,
        .leftWrist: .leftWrist, .rightWrist: .rightWrist,
        .leftHip: .leftHip, .rightHip: .rightHip,
        .leftKnee: .leftKnee, .rightKnee: .rightKnee,
        .leftAnkle: .leftAnkle, .rightAnkle: .rightAnkle
    ]

    private let mode: Mode
    private let exercise: RepExercise
    private let texts: RepCounterTexts
    private let onFinish: (_ reps: Int, _ durationSeconds: Int, _ cancelled: Bool) -> Void

    private let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "app.pushuptracker.mobile.repcounter.session")
    private let videoQueue = DispatchQueue(label: "app.pushuptracker.mobile.repcounter.video")
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private let bodyPoseRequest = VNDetectHumanBodyPoseRequest()
    /// Touched only on `videoQueue`.
    private let machine: RepStateMachine
    private let proximityCounter = ProximityRepCounter()

    private var reps = 0
    private var startedAt: CFTimeInterval = 0
    private var finished = false
    private var clockTimer: Timer?
    private var wasIdleTimerDisabled = false
    private var beep: AVAudioPlayer?
    private var previousAudio: (category: AVAudioSession.Category, mode: AVAudioSession.Mode, options: AVAudioSession.CategoryOptions)?

    private let titleLabel = UILabel()
    private let counterLabel = UILabel()
    private let clockLabel = UILabel()
    private let hintView = UIView()
    private let hintLabel = UILabel()
    private let messageLabel = UILabel()
    private let cancelButton = UIButton(type: .system)
    private let doneButton = UIButton(type: .system)

    init(mode: Mode, exercise: RepExercise, locale: String, onFinish: @escaping (Int, Int, Bool) -> Void) {
        self.mode = mode
        self.exercise = exercise
        self.texts = RepCounterTexts(locale: locale)
        self.onFinish = onFinish
        self.machine = RepStateMachine(exercise: exercise)
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
        overrideUserInterfaceStyle = .dark
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .portrait }
    override var prefersStatusBarHidden: Bool { true }

    // MARK: lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        if mode == .camera {
            let layer = AVCaptureVideoPreviewLayer(session: session)
            layer.videoGravity = .resizeAspectFill
            view.layer.addSublayer(layer)
            previewLayer = layer
        }
        buildInterface()
        switch mode {
        case .camera: configureCamera()
        case .noCamera: showMessage(texts.noCamera)
        case .proximity: showMessage(texts.proximityHelp)
        }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard startedAt == 0 else { return }
        startedAt = CACurrentMediaTime()
        wasIdleTimerDisabled = UIApplication.shared.isIdleTimerDisabled
        UIApplication.shared.isIdleTimerDisabled = true
        prepareSound()
        clockTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in self?.updateClock() }
        switch mode {
        case .camera:
            sessionQueue.async { [session] in session.startRunning() }
        case .proximity:
            UIDevice.current.isProximityMonitoringEnabled = true
            NotificationCenter.default.addObserver(self, selector: #selector(proximityChanged), name: UIDevice.proximityStateDidChangeNotification, object: nil)
        case .noCamera:
            break
        }
    }

    // MARK: interface

    private func buildInterface() {
        titleLabel.text = texts.title(exercise, proximity: mode == .proximity)
        titleLabel.textColor = .white
        titleLabel.font = .systemFont(ofSize: 20, weight: .semibold)
        titleLabel.textAlignment = .center

        counterLabel.text = "0"
        counterLabel.textColor = .white
        counterLabel.font = .monospacedDigitSystemFont(ofSize: 160, weight: .heavy)
        counterLabel.textAlignment = .center
        counterLabel.adjustsFontSizeToFitWidth = true
        counterLabel.minimumScaleFactor = 0.4
        counterLabel.layer.shadowColor = UIColor.black.cgColor
        counterLabel.layer.shadowOpacity = 0.6
        counterLabel.layer.shadowRadius = 12
        counterLabel.layer.shadowOffset = .zero
        for label in [titleLabel, clockLabel] {
            // Readable over a bright camera frame.
            label.layer.shadowColor = UIColor.black.cgColor
            label.layer.shadowOpacity = 0.8
            label.layer.shadowRadius = 6
            label.layer.shadowOffset = .zero
        }
        counterLabel.accessibilityIdentifier = "repCounterValue"

        clockLabel.text = "0:00"
        clockLabel.textColor = UIColor.white.withAlphaComponent(0.8)
        clockLabel.font = .monospacedDigitSystemFont(ofSize: 22, weight: .medium)
        clockLabel.textAlignment = .center

        hintView.backgroundColor = UIColor(red: 0.98, green: 0.75, blue: 0.14, alpha: 0.95)
        hintView.layer.cornerRadius = 16
        hintView.isHidden = true
        hintLabel.text = texts.hint
        hintLabel.textColor = .black
        hintLabel.font = .systemFont(ofSize: 18, weight: .semibold)
        hintLabel.numberOfLines = 0
        hintLabel.textAlignment = .center
        hintLabel.translatesAutoresizingMaskIntoConstraints = false
        hintView.addSubview(hintLabel)

        messageLabel.textColor = .white
        messageLabel.font = .systemFont(ofSize: 18, weight: .regular)
        messageLabel.numberOfLines = 0
        messageLabel.textAlignment = .center
        messageLabel.isHidden = true

        style(cancelButton, title: texts.cancel, background: UIColor.white.withAlphaComponent(0.2))
        style(doneButton, title: texts.done, background: UIColor(red: 0.98, green: 0.45, blue: 0.09, alpha: 1))
        cancelButton.accessibilityIdentifier = "repCounterCancel"
        doneButton.accessibilityIdentifier = "repCounterDone"
        cancelButton.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
        doneButton.addTarget(self, action: #selector(doneTapped), for: .touchUpInside)

        let buttons = UIStackView(arrangedSubviews: [cancelButton, doneButton])
        buttons.axis = .horizontal
        buttons.distribution = .fillEqually
        buttons.spacing = 12

        let center = UIStackView(arrangedSubviews: [counterLabel, clockLabel])
        center.axis = .vertical
        center.spacing = 4

        for item in [titleLabel, hintView, center, messageLabel, buttons] as [UIView] {
            item.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(item)
        }
        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            titleLabel.topAnchor.constraint(equalTo: guide.topAnchor, constant: 16),
            titleLabel.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 16),
            titleLabel.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -16),

            hintView.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 16),
            hintView.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 16),
            hintView.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -16),
            hintLabel.topAnchor.constraint(equalTo: hintView.topAnchor, constant: 12),
            hintLabel.bottomAnchor.constraint(equalTo: hintView.bottomAnchor, constant: -12),
            hintLabel.leadingAnchor.constraint(equalTo: hintView.leadingAnchor, constant: 16),
            hintLabel.trailingAnchor.constraint(equalTo: hintView.trailingAnchor, constant: -16),

            center.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            center.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 16),
            center.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -16),

            messageLabel.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 24),
            messageLabel.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -24),
            messageLabel.bottomAnchor.constraint(equalTo: buttons.topAnchor, constant: -24),

            buttons.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 16),
            buttons.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -16),
            buttons.bottomAnchor.constraint(equalTo: guide.bottomAnchor, constant: -16),
            buttons.heightAnchor.constraint(equalToConstant: 64)
        ])
    }

    private func style(_ button: UIButton, title: String, background: UIColor) {
        button.setTitle(title, for: .normal)
        button.setTitleColor(.white, for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 22, weight: .bold)
        button.backgroundColor = background
        button.layer.cornerRadius = 20
    }

    private func showMessage(_ text: String) {
        messageLabel.text = text
        messageLabel.isHidden = false
    }

    private func updateClock() {
        guard startedAt > 0 else { return }
        let seconds = Int(CACurrentMediaTime() - startedAt)
        clockLabel.text = String(format: "%d:%02d", seconds / 60, seconds % 60)
    }

    /// Main thread: new count / hint state from the camera or the sensor.
    private func show(reps count: Int, hint: Bool, counted: Bool) {
        guard !finished else { return }
        reps = count
        counterLabel.text = String(count)
        hintView.isHidden = !hint
        if counted {
            beep?.currentTime = 0
            beep?.play()
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        }
    }

    // MARK: camera

    private func configureCamera() {
        sessionQueue.async { [weak self] in
            guard let self else { return }
            let ok = self.setUpSession()
            if !ok {
                DispatchQueue.main.async { self.showMessage(self.texts.cameraFailed) }
            }
        }
    }

    private func setUpSession() -> Bool {
        guard let device = Self.captureDevice(), let input = try? AVCaptureDeviceInput(device: device) else { return false }
        session.beginConfiguration()
        defer { session.commitConfiguration() }
        if session.canSetSessionPreset(.hd1280x720) { session.sessionPreset = .hd1280x720 }
        guard session.canAddInput(input) else { return false }
        session.addInput(input)
        let output = AVCaptureVideoDataOutput()
        output.alwaysDiscardsLateVideoFrames = true
        output.setSampleBufferDelegate(self, queue: videoQueue)
        guard session.canAddOutput(output) else { return false }
        session.addOutput(output)
        if let connection = output.connection(with: .video) {
            // Frames come upright (portrait), so Vision gets them with orientation `.up`.
            if #available(iOS 17.0, *) {
                if connection.isVideoRotationAngleSupported(90) { connection.videoRotationAngle = 90 }
            } else if connection.isVideoOrientationSupported {
                connection.videoOrientation = .portrait
            }
        }
        return true
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let width = Double(CVPixelBufferGetWidth(pixels))
        let height = Double(CVPixelBufferGetHeight(pixels))
        let handler = VNImageRequestHandler(cvPixelBuffer: pixels, orientation: .up, options: [:])
        var joints: [PoseJoint: PosePoint] = [:]
        if (try? handler.perform([bodyPoseRequest])) != nil,
           let observation = bodyPoseRequest.results?.max(by: { $0.confidence < $1.confidence }),
           let points = try? observation.recognizedPoints(.all) {
            for (name, joint) in Self.jointNames {
                guard let point = points[name] else { continue }
                // Normalised → pixels, so angles are not skewed by the frame's aspect ratio.
                joints[joint] = PosePoint(x: Double(point.location.x) * width, y: Double(point.location.y) * height, confidence: Double(point.confidence))
            }
        }
        let time = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
        let frame = PoseFrame.from(joints: joints, exercise: exercise, time: time, yGrowsUp: true)
        let counted = machine.process(frame)
        let count = machine.reps
        let hint = machine.showHint
        DispatchQueue.main.async { [weak self] in self?.show(reps: count, hint: hint, counted: counted) }
    }

    // MARK: proximity

    @objc private func proximityChanged() {
        let counted = proximityCounter.process(time: CACurrentMediaTime(), near: UIDevice.current.proximityState)
        show(reps: proximityCounter.reps, hint: false, counted: counted)
    }

    // MARK: sound

    private func prepareSound() {
        let audio = AVAudioSession.sharedInstance()
        previousAudio = (audio.category, audio.mode, audio.categoryOptions)
        // Playback: heard with the silent switch on and when the phone lies on the floor.
        try? audio.setCategory(.playback, mode: .default, options: [.mixWithOthers])
        try? audio.setActive(true)
        beep = try? AVAudioPlayer(data: Self.beepWave(), fileTypeHint: AVFileType.wav.rawValue)
        beep?.prepareToPlay()
    }

    /// A short 1.3 kHz beep as 16-bit mono PCM WAV (no sound file in the bundle).
    static func beepWave() -> Data {
        let sampleRate = 44_100
        let count = sampleRate * 12 / 100
        var data = Data()
        func append<T: FixedWidthInteger>(_ value: T) { withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) } }
        data.append(contentsOf: Array("RIFF".utf8))
        append(UInt32(36 + count * 2))
        data.append(contentsOf: Array("WAVEfmt ".utf8))
        append(UInt32(16))
        append(UInt16(1))
        append(UInt16(1))
        append(UInt32(sampleRate))
        append(UInt32(sampleRate * 2))
        append(UInt16(2))
        append(UInt16(16))
        data.append(contentsOf: Array("data".utf8))
        append(UInt32(count * 2))
        let fade = Double(sampleRate) * 0.01
        for index in 0..<count {
            let envelope = min(1, Double(index) / fade, Double(count - index) / fade)
            let sample = sin(2 * Double.pi * 1320 * Double(index) / Double(sampleRate)) * envelope * 0.8
            append(Int16(sample * Double(Int16.max)))
        }
        return data
    }

    // MARK: finish

    @objc private func cancelTapped() { finish(cancelled: true) }
    @objc private func doneTapped() { finish(cancelled: false) }

    private func finish(cancelled: Bool) {
        guard !finished else { return }
        finished = true
        let duration = startedAt > 0 ? max(1, Int((CACurrentMediaTime() - startedAt).rounded())) : 1
        let count = reps
        clockTimer?.invalidate()
        clockTimer = nil
        NotificationCenter.default.removeObserver(self)
        if mode == .proximity { UIDevice.current.isProximityMonitoringEnabled = false }
        if mode == .camera { sessionQueue.async { [session] in session.stopRunning() } }
        UIApplication.shared.isIdleTimerDisabled = wasIdleTimerDisabled
        beep?.stop()
        if let previous = previousAudio {
            let audio = AVAudioSession.sharedInstance()
            try? audio.setActive(false, options: .notifyOthersOnDeactivation)
            try? audio.setCategory(previous.category, mode: previous.mode, options: previous.options)
        }
        dismiss(animated: true) { [onFinish] in onFinish(count, duration, cancelled) }
    }
}

/// Texts of the native screen (ru / en, like the rest of the app).
struct RepCounterTexts {
    let locale: String

    private var ru: Bool { locale != "en" }

    var done: String { ru ? "Готово" : "Done" }
    var cancel: String { ru ? "Отмена" : "Cancel" }
    var hint: String { ru ? "Встаньте так, чтобы было видно всё тело" : "Stand so that your whole body is visible" }
    var noCamera: String {
        ru ? "На этом устройстве нет камеры — посчитать повторения камерой не получится. Нажмите «Отмена» и введите число вручную."
            : "This device has no camera, so reps can't be counted with it. Tap Cancel and enter the number yourself."
    }
    var cameraFailed: String {
        ru ? "Не удалось включить камеру. Нажмите «Отмена» и введите число вручную."
            : "Couldn't start the camera. Tap Cancel and enter the number yourself."
    }
    var proximityHelp: String {
        ru ? "Положите телефон экраном вверх под грудь. Каждое касание груди — повторение."
            : "Put the phone face up under your chest. Every touch with the chest is a rep."
    }

    func title(_ exercise: RepExercise, proximity: Bool) -> String {
        let name: String
        switch exercise {
        case .pushups: name = ru ? "Отжимания" : "Push-ups"
        case .squats: name = ru ? "Приседания" : "Squats"
        case .pullups: name = ru ? "Подтягивания" : "Pull-ups"
        }
        if proximity { return ru ? "\(name) · касание" : "\(name) · touch" }
        return ru ? "\(name) · камера" : "\(name) · camera"
    }
}
