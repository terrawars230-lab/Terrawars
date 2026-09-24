import CoreLocation
import Foundation
import React

/**
 iOS counterpart to Android's `WalkTrackingService`.

 There is no service concept on iOS. Continuous location while the app is
 backgrounded comes from the `location` background mode plus
 `allowsBackgroundLocationUpdates`, and the blue status bar indicator plays the
 role Android's persistent notification plays (FR-11).

 Deliberate choices:

 - **`requestWhenInUseAuthorization`, never `requestAlways`.** ADR D-04 rules
   out background location, and When-In-Use plus the background mode is enough
   to keep recording with the screen off during an active walk. Asking for
   Always would trigger App Review scrutiny for a capability we do not want.
 - **`pausesLocationUpdatesAutomatically = false`.** iOS otherwise pauses
   updates when it decides the user has stopped moving, which silently punches
   a hole in the middle of a walk — and a walk with a gap does not close a loop.
 - **`kCLLocationAccuracyBest`, not `…BestForNavigation`.** Apple intends the
   navigation level for a phone on a charger; on foot, for an hour, it spends
   the NFR-01 battery budget for accuracy GR-01 then throws away.
 - **No filtering or decision-making here.** Samples go straight to JS; GR-01
   runs in TypeScript for the preview and in Postgres for the verdict.
 - **All state lives on the main queue.** The delegate is called there, so
   every exported method hops there before touching it.

 Keep every `@objc(...)` selector in exact step with WalkTracker.m.
 */
@objc(WalkTracker)
class WalkTracker: RCTEventEmitter, CLLocationManagerDelegate {

  private let manager = CLLocationManager()
  private var isTracking = false
  private var isPaused = false
  private var sampleCount = 0
  private var hasListeners = false

  /// One-shot `getCurrentPosition` requests still waiting for a fix, by id, so
  /// two overlapping requests each get an answer and each timeout only ever
  /// settles its own request.
  private struct PendingFix {
    let resolve: RCTPromiseResolveBlock
    let reject: RCTPromiseRejectBlock
  }
  private var pendingFixes: [UUID: PendingFix] = [:]

  private enum Event: String, CaseIterable {
    case sample = "WalkTracker:sample"
    case stopped = "WalkTracker:stopped"
    case error = "WalkTracker:error"
  }

  override init() {
    super.init()
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyBest
    manager.activityType = .fitness
    manager.pausesLocationUpdatesAutomatically = false
  }

  // MARK: - RCTEventEmitter

  override static func requiresMainQueueSetup() -> Bool { true }

  override func supportedEvents() -> [String]! {
    Event.allCases.map { $0.rawValue }
  }

  override func startObserving() { hasListeners = true }
  override func stopObserving() { hasListeners = false }

  private func emit(_ event: Event, _ body: Any) {
    guard hasListeners else { return }
    sendEvent(withName: event.rawValue, body: body)
  }

  // MARK: - Exported methods

  @objc(start:resolver:rejecter:)
  func start(
    options: NSDictionary,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      let status = self.manager.authorizationStatus

      switch status {
      case .notDetermined:
        // The rationale screen (doc 06 §5) has already been shown by JS before
        // we get here; this triggers the system dialog.
        self.manager.requestWhenInUseAuthorization()
      case .denied, .restricted:
        reject("E_PERMISSION", "Location permission denied", nil)
        return
      default:
        break
      }

      // A second start on a live recording would reset its counters and pause
      // state. The recording is already running; leave it exactly as it is.
      if self.isTracking {
        resolve(nil)
        return
      }

      // FR-12: 5 m distance filter.
      let distanceFilter = (options["distanceFilterM"] as? NSNumber)?.doubleValue ?? 5
      self.manager.distanceFilter = distanceFilter

      // Requires UIBackgroundModes = ["location"] in Info.plist. Setting it
      // without that entitlement raises, so it is guarded.
      if Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") != nil {
        self.manager.allowsBackgroundLocationUpdates = true
      }

      // The blue status-bar pill. Leaving it on is honest — the user should be
      // able to see at a glance that a walk is recording (doc 06 §4).
      self.manager.showsBackgroundLocationIndicator = true

      self.manager.startUpdatingLocation()
      self.isTracking = true
      self.isPaused = false
      self.sampleCount = 0

      resolve(nil)
    }
  }

  @objc(pause:rejecter:)
  func pause(resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      // FR-16: paused time records nothing. The manager keeps running so the
      // fix stays warm — restarting it costs a 10–20 s reacquisition, which the
      // user would experience as a hole at the start of the resumed segment.
      self.isPaused = true
      resolve(nil)
    }
  }

  @objc(resume:rejecter:)
  func resume(resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      self.isPaused = false
      resolve(nil)
    }
  }

  @objc(stop:rejecter:)
  func stop(resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      let wasTracking = self.isTracking
      self.manager.stopUpdatingLocation()
      if Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") != nil {
        self.manager.allowsBackgroundLocationUpdates = false
      }
      self.isTracking = false
      self.isPaused = false
      if wasTracking {
        self.emit(.stopped, ["reason": "user"])
      }
      resolve(nil)
    }
  }

  @objc(getStatus:rejecter:)
  func getStatus(resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      resolve([
        "isTracking": self.isTracking,
        "isPaused": self.isPaused,
        "sampleCount": self.sampleCount,
      ])
    }
  }

  /// One-shot fix for centring the map before a walk starts (FR-53).
  @objc(getCurrentPosition:resolver:rejecter:)
  func getCurrentPosition(
    timeoutMs: NSNumber,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      if let recent = self.manager.location,
         Date().timeIntervalSince(recent.timestamp) < 30 {
        resolve(self.serialise(recent))
        return
      }

      let id = UUID()
      self.pendingFixes[id] = PendingFix(resolve: resolve, reject: reject)

      // While a walk records, fixes are already arriving and the next one
      // answers this request. requestLocation() is only for when nothing is
      // running — it must never disturb a recording in progress.
      if !self.isTracking {
        self.manager.requestLocation()
      }

      let timeout = max(1, timeoutMs.doubleValue / 1000)
      DispatchQueue.main.asyncAfter(deadline: .now() + timeout) {
        guard let pending = self.pendingFixes.removeValue(forKey: id) else { return }
        pending.reject("E_NO_FIX", "Timed out waiting for a location fix", nil)
      }
    }
  }

  /// No-op on iOS; the Android notification is what this updates there (FR-11).
  @objc(updateNotification:body:resolver:rejecter:)
  func updateNotification(
    title: String,
    body: String,
    resolve: RCTPromiseResolveBlock,
    reject: RCTPromiseRejectBlock
  ) {
    resolve(nil)
  }

  // MARK: - CLLocationManagerDelegate

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    // Answer every waiting one-shot request — and then carry on. Returning
    // here, as this used to, silently dropped the walk samples in the same
    // batch whenever the map asked for a fix mid-walk.
    if let latest = locations.last, !pendingFixes.isEmpty {
      let waiting = pendingFixes
      pendingFixes.removeAll()
      let payload = serialise(latest)
      for (_, fix) in waiting {
        fix.resolve(payload)
      }
    }

    guard isTracking, !isPaused else { return }

    for location in locations {
      sampleCount += 1
      emit(.sample, serialise(location))
    }
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    if !pendingFixes.isEmpty {
      let waiting = pendingFixes
      pendingFixes.removeAll()
      for (_, fix) in waiting {
        fix.reject("E_LOCATION_FAILED", error.localizedDescription, error)
      }
    }

    // `.locationUnknown` is transient — iOS is still working on a fix and will
    // deliver one shortly. Reporting it would put a scary error in front of a
    // user who is simply standing between two buildings.
    if let clError = error as? CLError, clError.code == .locationUnknown { return }

    // A failed one-shot request is not a walk error.
    guard isTracking else { return }
    emit(.error, ["message": error.localizedDescription])
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    switch manager.authorizationStatus {
    case .denied, .restricted:
      if isTracking {
        manager.stopUpdatingLocation()
        isTracking = false
        isPaused = false
        emit(.stopped, ["reason": "permission-revoked"])
      }
    default:
      break
    }
  }

  // MARK: - Serialisation

  /// Matches the Android payload exactly. `-1` is the agreed "unknown" sentinel;
  /// the JS bridge maps it back to `null` (see `nativeWalkTracker.ts`).
  private func serialise(_ location: CLLocation) -> [String: Any] {
    [
      "latitude": location.coordinate.latitude,
      "longitude": location.coordinate.longitude,
      "timestamp": location.timestamp.timeIntervalSince1970 * 1000,
      "accuracy": location.horizontalAccuracy >= 0 ? location.horizontalAccuracy : -1,
      "speed": location.speed >= 0 ? location.speed : -1,
      "altitude": location.altitude,
      "heading": location.course >= 0 ? location.course : -1,
      // doc 06 §2. iOS exposes far less than Android here: `sourceInformation`
      // reports simulated locations from iOS 15 on, and there is no equivalent
      // of Android's mock-provider flag. This is why the server never trusts
      // the client signal and device checks carry the weight.
      "isMock": Self.isSimulated(location),
    ]
  }

  private static func isSimulated(_ location: CLLocation) -> Bool {
    if #available(iOS 15.0, *) {
      return location.sourceInformation?.isSimulatedBySoftware ?? false
    }
    return false
  }
}
