package com.terrawars.location

import android.content.Intent
import android.location.Location
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource

/**
 * JS bridge for [WalkTrackingService].
 *
 * Every method is a thin pass-through to the service. All the judgement — which
 * points to keep, when a loop closed, what a claim is worth — lives in
 * TypeScript and in Postgres, never here. Native code that makes decisions is
 * native code you cannot unit-test.
 */
class WalkTrackerModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext), WalkTrackingService.SampleListener {

  companion object {
    const val NAME = "WalkTracker"

    private const val EVENT_SAMPLE = "WalkTracker:sample"
    private const val EVENT_STOPPED = "WalkTracker:stopped"
    private const val EVENT_ERROR = "WalkTracker:error"
  }

  override fun getName(): String = NAME

  override fun initialize() {
    super.initialize()
    WalkTrackingService.listener = this
  }

  override fun invalidate() {
    WalkTrackingService.listener = null
    super.invalidate()
  }

  // ── React methods ─────────────────────────────────────────────────────────

  @ReactMethod
  fun start(options: ReadableMap, promise: Promise) {
    try {
      val intent = Intent(reactContext, WalkTrackingService::class.java).apply {
        action = WalkTrackingService.ACTION_START
        putExtra(
          WalkTrackingService.EXTRA_DISTANCE_FILTER_M,
          options.getDouble("distanceFilterM").toFloat(),
        )
        putExtra(
          WalkTrackingService.EXTRA_MAX_INTERVAL_MS,
          options.getDouble("maxIntervalMs").toLong(),
        )
        putExtra(
          WalkTrackingService.EXTRA_NOTIFICATION_TITLE,
          options.getString("notificationTitle"),
        )
        putExtra(
          WalkTrackingService.EXTRA_NOTIFICATION_BODY,
          options.getString("notificationBody"),
        )
      }

      // From Android 8 a background start must use startForegroundService, and
      // the service then has five seconds to call startForeground or the system
      // kills it with a ForegroundServiceDidNotStartInTimeException.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        reactContext.startForegroundService(intent)
      } else {
        reactContext.startService(intent)
      }

      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("E_START_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun pause(promise: Promise) = sendAction(WalkTrackingService.ACTION_PAUSE, promise)

  @ReactMethod
  fun resume(promise: Promise) = sendAction(WalkTrackingService.ACTION_RESUME, promise)

  @ReactMethod
  fun stop(promise: Promise) = sendAction(WalkTrackingService.ACTION_STOP, promise)

  @ReactMethod
  fun getStatus(promise: Promise) {
    val status = Arguments.createMap().apply {
      putBoolean("isTracking", WalkTrackingService.isRunning)
      putBoolean("isPaused", WalkTrackingService.isPaused)
      putInt("sampleCount", WalkTrackingService.sampleCount)
    }
    promise.resolve(status)
  }

  /** One-shot fix for centring the map before a walk starts (FR-53). */
  @ReactMethod
  fun getCurrentPosition(timeoutMs: Double, promise: Promise) {
    try {
      val client = LocationServices.getFusedLocationProviderClient(reactContext)
      val cancellation = CancellationTokenSource()

      client.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, cancellation.token)
        .addOnSuccessListener { location ->
          if (location == null) {
            promise.reject("E_NO_FIX", "No location fix available")
          } else {
            promise.resolve(location.toWritableMap())
          }
        }
        .addOnFailureListener { error ->
          promise.reject("E_LOCATION_FAILED", error.message, error)
        }
    } catch (error: SecurityException) {
      promise.reject("E_PERMISSION", "Location permission not granted", error)
    } catch (error: Exception) {
      promise.reject("E_LOCATION_FAILED", error.message, error)
    }
  }

  /**
   * Updates the persistent notification with live distance and duration (FR-11).
   *
   * ACTION_UPDATE_NOTIFICATION, never ACTION_START. This fires every ten
   * seconds while the HUD ticks; sending START re-registered the location
   * request, cleared the paused flag and zeroed the sample counter on every
   * tick, which is what made a paused walk resume itself and the live pace
   * readout jump around.
   */
  @ReactMethod
  fun updateNotification(title: String, body: String, promise: Promise) {
    // Only meaningful while the service is already up; starting a dead service
    // to refresh text would begin tracking without the user asking.
    if (!WalkTrackingService.isRunning) {
      promise.resolve(null)
      return
    }

    val intent = Intent(reactContext, WalkTrackingService::class.java).apply {
      action = WalkTrackingService.ACTION_UPDATE_NOTIFICATION
      putExtra(WalkTrackingService.EXTRA_NOTIFICATION_TITLE, title)
      putExtra(WalkTrackingService.EXTRA_NOTIFICATION_BODY, body)
    }

    try {
      reactContext.startService(intent)
    } catch (error: Exception) {
      // A notification refresh is cosmetic and must never fail a walk.
    }
    promise.resolve(null)
  }

  // Required by NativeEventEmitter on the JS side. No bookkeeping needed —
  // events are broadcast, not per-listener.
  @ReactMethod
  fun addListener(eventName: String) = Unit

  @ReactMethod
  fun removeListeners(count: Int) = Unit

  // ── WalkTrackingService.SampleListener ────────────────────────────────────

  override fun onSample(location: Location) {
    emit(EVENT_SAMPLE, location.toWritableMap())
  }

  override fun onStopped(reason: String) {
    emit(EVENT_STOPPED, Arguments.createMap().apply { putString("reason", reason) })
  }

  override fun onError(message: String) {
    emit(EVENT_ERROR, Arguments.createMap().apply { putString("message", message) })
  }

  private fun emit(event: String, payload: WritableMap) {
    if (!reactContext.hasActiveReactInstance()) return

    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(event, payload)
  }

  private fun sendAction(action: String, promise: Promise) {
    try {
      reactContext.startService(
        Intent(reactContext, WalkTrackingService::class.java).apply { this.action = action },
      )
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("E_SERVICE_ACTION_FAILED", error.message, error)
    }
  }

  /**
   * Converts a [Location] to the JS payload.
   *
   * `-1` is the agreed "unknown" sentinel for accuracy, speed and heading; the
   * JS bridge maps it back to `null`. Sending `null` across the bridge for a
   * numeric field is more error-prone than a sentinel both sides agree on.
   */
  private fun Location.toWritableMap(): WritableMap = Arguments.createMap().apply {
    putDouble("latitude", latitude)
    putDouble("longitude", longitude)
    putDouble("timestamp", time.toDouble())
    putDouble("accuracy", if (hasAccuracy()) accuracy.toDouble() else -1.0)
    putDouble("speed", if (hasSpeed()) speed.toDouble() else -1.0)
    putDouble("altitude", if (hasAltitude()) altitude else 0.0)
    putDouble("heading", if (hasBearing()) bearing.toDouble() else -1.0)
    // doc 06 §2: collected and uploaded, never trusted, judged server-side.
    putBoolean("isMock", isFromMockProviderCompat())
  }

  @Suppress("DEPRECATION")
  private fun Location.isFromMockProviderCompat(): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) isMock else isFromMockProvider
}
