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
 - **No filtering or decision-making here.** Samples go straight to JS; GR-01
   runs in TypeScript for the preview and in Postgres for the verdict.
 */
@objc(WalkTracker)
class WalkTracker: RCTEventEmitter, CLLocationManagerDelegate {

  private let manager = CLLocationManager()
  private var isTracking = false
  private var isPaused = false
  private var sampleCount = 0
  private var hasListeners = false

  /// Resolves the one-shot `getCurrentPosition` request, if one is in flight.
  private var oneShotResolve: RCTPromiseResolveBlock?
  private var oneShotReject: RCTPromiseRejectBlock?

  private enum Event: String, CaseIterable {
    case sample = "WalkTracker:sample"
    case stopped = "WalkTracker:stopped"
    case error = "WalkTracker:error"
  }

  override init() {
    super.init()
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
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
  func pause(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    // FR-16: paused time records nothing. The manager keeps running so the
    // fix stays warm — restarting it costs a 10–20 s reacquisition, which the
    // user would experience as a hole at the start of the resumed segment.
    isPaused = true
    resolve(nil)
  }

  @objc(resume:rejecter:)
  func resume(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    isPaused = false
    resolve(nil)
  }

  @objc(stop:rejecter:)
  func stop(resolve: @escaping RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      self.manager.stopUpdatingLocation()
      self.manager.allowsBackgroundLocationUpdates = false
      self.isTracking = false
      self.isPaused = false
      self.emit(.stopped, ["reason": "user"])
      resolve(nil)
    }
  }

  @objc(getStatus:rejecter:)
  func getStatus(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    resolve([
      "isTracking": isTracking,
      "isPaused": isPaused,
      "sampleCount": sampleCount,
    ])
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

      self.oneShotResolve = resolve
      self.oneShotReject = reject
      self.manager.requestLocation()

      let timeout = timeoutMs.doubleValue / 1000
      DispatchQueue.main.asyncAfter(deadline: .now() + timeout) {
        guard let pendingReject = self.oneShotReject else { return }
        self.oneShotResolve = nil
        self.oneShotReject = nil
        pendingReject("E_NO_FIX", "Timed out waiting for a location fix", nil)
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
    if let pendingResolve = oneShotResolve, let location = locations.last {
      oneShotResolve = nil
      oneShotReject = nil
      pendingResolve(serialise(location))
      return
    }

    guard isTracking, !isPaused else { return }

    for location in locations {
      sampleCount += 1
      emit(.sample, serialise(location))
    }
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    if let pendingReject = oneShotReject {
      oneShotResolve = nil
      oneShotReject = nil
      pendingReject("E_LOCATION_FAILED", error.localizedDescription, error)
      return
    }

    // `.locationUnknown` is transient — iOS is still working on a fix and will
    // deliver one shortly. Reporting it would put a scary error in front of a
    // user who is simply standing between two buildings.
    if let clError = error as? CLError, clError.code == .locationUnknown { return }

    emit(.error, ["message": error.localizedDescription])
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    switch manager.authorizationStatus {
    case .denied, .restricted:
      if isTracking {
        manager.stopUpdatingLocation()
        isTracking = false
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
      // the client signal and Play Integrity / device checks carry the weight.
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
