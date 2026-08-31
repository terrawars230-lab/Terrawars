package com.terrawars.location

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.os.Build
import android.os.IBinder
import android.os.Looper
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.terrawars.MainActivity
import com.terrawars.R

/**
 * Foreground service that records a walk (FR-11, doc 06 §5).
 *
 * Why a service at all: Android stops delivering location to a backgrounded
 * process within seconds. A walk lasts 20–45 minutes with the screen off, so
 * the recording has to live in a foreground service with a persistent
 * notification, declared as `foregroundServiceType="location"` — required from
 * Android 14 and declared in the Play Console (doc 06 §6).
 *
 * We deliberately do NOT request ACCESS_BACKGROUND_LOCATION (ADR D-04). A
 * foreground service started while the app is visible keeps receiving updates
 * without it, and asking for it would trigger Play's sensitive-permission
 * review for no gain.
 *
 * The service holds no walk state beyond a sample counter. Points are handed
 * straight to JS, which persists every one of them immediately (FR-15) — if
 * this process is killed, nothing is lost that had already been emitted.
 */
class WalkTrackingService : Service() {

  companion object {
    const val ACTION_START = "com.terrawars.walk.START"
    const val ACTION_PAUSE = "com.terrawars.walk.PAUSE"
    const val ACTION_RESUME = "com.terrawars.walk.RESUME"
    const val ACTION_STOP = "com.terrawars.walk.STOP"

    /**
     * Refreshes the notification text ONLY (FR-11).
     *
     * Separate from ACTION_START because it is delivered every ten seconds
     * while the HUD ticks. Routing it through handleStart re-registered the
     * location request, reset the paused flag and zeroed the sample counter on
     * every tick — which restarted the GPS cadence mid-walk, silently
     * un-paused a paused walk, and made the distance readout jump.
     */
    const val ACTION_UPDATE_NOTIFICATION = "com.terrawars.walk.UPDATE_NOTIFICATION"

    const val EXTRA_DISTANCE_FILTER_M = "distanceFilterM"
    const val EXTRA_MAX_INTERVAL_MS = "maxIntervalMs"
    const val EXTRA_NOTIFICATION_TITLE = "notificationTitle"
    const val EXTRA_NOTIFICATION_BODY = "notificationBody"

    private const val CHANNEL_ID = "walk_tracking"
    private const val NOTIFICATION_ID = 4201

    /**
     * Set by the native module so emitted samples can reach JS.
     *
     * A static hand-off rather than a bound service: binding adds a lifecycle
     * race on every start, and the module and the service always live in the
     * same process.
     */
    @Volatile
    var listener: SampleListener? = null

    @Volatile
    var isRunning: Boolean = false
      private set

    @Volatile
    var isPaused: Boolean = false
      private set

    @Volatile
    var sampleCount: Int = 0
      private set
  }

  /** Implemented by the native module. */
  interface SampleListener {
    fun onSample(location: Location)
    fun onStopped(reason: String)
    fun onError(message: String)
  }

  private lateinit var fusedClient: FusedLocationProviderClient
  private var notificationTitle: String = "Walk in progress"
  private var notificationBody: String = ""

  private val locationCallback = object : LocationCallback() {
    override fun onLocationResult(result: LocationResult) {
      // FR-16: paused time records nothing at all.
      if (isPaused) return

      for (location in result.locations) {
        sampleCount += 1
        listener?.onSample(location)
      }
    }
  }

  override fun onCreate() {
    super.onCreate()
    fusedClient = LocationServices.getFusedLocationProviderClient(this)
    createNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> handleStart(intent)
      ACTION_UPDATE_NOTIFICATION -> handleUpdateNotification(intent)
      ACTION_PAUSE -> handlePause()
      ACTION_RESUME -> handleResume()
      ACTION_STOP -> handleStop("user")
      else -> {
        // Restarted by the system with a null intent. We cannot recover the
        // walk parameters, and silently resuming with defaults would corrupt
        // the sampling profile, so we report the kill and stop.
        // doc 06 §8.2: this is the Xiaomi/Oppo/Vivo case, and JS needs to know.
        listener?.onStopped("killed-by-system")
        stopSelf()
      }
    }

    // START_NOT_STICKY: never let the system resurrect this with a null intent
    // behind the user's back. A walk that restarts itself without the user
    // knowing is both a data-quality problem and a privacy one.
    return START_NOT_STICKY
  }

  /**
   * Updates the persistent notification text without touching the recording.
   *
   * Deliberately does nothing when the service is not running: a notification
   * refresh must never be the thing that starts a walk.
   */
  private fun handleUpdateNotification(intent: Intent) {
    if (!isRunning) {
      stopSelf()
      return
    }
    notificationTitle = intent.getStringExtra(EXTRA_NOTIFICATION_TITLE) ?: notificationTitle
    notificationBody = intent.getStringExtra(EXTRA_NOTIFICATION_BODY) ?: notificationBody
    updateNotification()
  }

  private fun handleStart(intent: Intent) {
    notificationTitle = intent.getStringExtra(EXTRA_NOTIFICATION_TITLE) ?: notificationTitle
    notificationBody = intent.getStringExtra(EXTRA_NOTIFICATION_BODY) ?: notificationBody

    // A second START on a live service would re-register the location request
    // and reset the walk counters. Refresh the notification and leave the
    // recording exactly as it is.
    if (isRunning) {
      updateNotification()
      return
    }

    startAsForeground()

    if (!hasLocationPermission()) {
      listener?.onStopped("permission-revoked")
      stopSelf()
      return
    }

    val distanceFilterM = intent.getFloatExtra(EXTRA_DISTANCE_FILTER_M, 5f)
    val maxIntervalMs = intent.getLongExtra(EXTRA_MAX_INTERVAL_MS, 5_000L)

    // FR-12: 5 m distance filter, 5 s maximum interval.
    //
    // PRIORITY_HIGH_ACCURACY is the only setting that yields a usable route —
    // BALANCED gives cell/wifi fixes tens of metres out, which the GR-01
    // accuracy filter would then discard. The NFR-01 8%/hour battery budget is
    // met through the distance filter and the interval floor, not by degrading
    // the fix quality.
    val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, maxIntervalMs)
      .setMinUpdateIntervalMillis(1_000L)
      .setMinUpdateDistanceMeters(distanceFilterM)
      .setWaitForAccurateLocation(true)
      .build()

    try {
      fusedClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper())
      isRunning = true
      isPaused = false
      sampleCount = 0
    } catch (error: SecurityException) {
      listener?.onStopped("permission-revoked")
      stopSelf()
    } catch (error: Exception) {
      listener?.onError(error.message ?: "Could not start location updates")
      stopSelf()
    }
  }

  private fun handlePause() {
    isPaused = true
    updateNotification()
  }

  private fun handleResume() {
    isPaused = false
    updateNotification()
  }

  private fun handleStop(reason: String) {
    fusedClient.removeLocationUpdates(locationCallback)
    isRunning = false
    isPaused = false
    listener?.onStopped(reason)

    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  override fun onDestroy() {
    if (isRunning) {
      // Reached without an explicit stop: the system took the process. Tell JS
      // so the user can be offered their partial walk rather than losing it.
      fusedClient.removeLocationUpdates(locationCallback)
      isRunning = false
      listener?.onStopped("killed-by-system")
    }
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  // ── Notification (FR-11) ──────────────────────────────────────────────────

  private fun startAsForeground() {
    val notification = buildNotification()

    // Android 14+ requires the foreground service type at start time, and it
    // must match the manifest declaration or the start throws.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun updateNotification() {
    val manager = getSystemService(NotificationManager::class.java)
    manager?.notify(NOTIFICATION_ID, buildNotification())
  }

  /** Called by the native module to show live distance and duration (FR-11). */
  fun updateNotificationText(title: String, body: String) {
    notificationTitle = title
    notificationBody = body
    updateNotification()
  }

  private fun buildNotification(): Notification {
    val contentIntent = PendingIntent.getActivity(
      this,
      0,
      Intent(this, MainActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
      },
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(notificationTitle)
      .setContentText(notificationBody)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentIntent(contentIntent)
      .setOngoing(true)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      // The notification shows distance walked. That is not secret, but it is
      // personal, so it stays off a locked screen.
      .setVisibility(NotificationCompat.VISIBILITY_SECRET)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .build()
  }

  private fun createNotificationChannel() {
    val manager = getSystemService(NotificationManager::class.java) ?: return
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return

    val channel = NotificationChannel(
      CHANNEL_ID,
      getString(R.string.walk_channel_name),
      // LOW: no sound, no heads-up. The notification is a status indicator that
      // sits there for 45 minutes; anything higher would be hostile.
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = getString(R.string.walk_channel_description)
      setShowBadge(false)
      enableVibration(false)
    }

    manager.createNotificationChannel(channel)
  }

  private fun hasLocationPermission(): Boolean =
    ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) ==
      PackageManager.PERMISSION_GRANTED ||
      ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) ==
      PackageManager.PERMISSION_GRANTED
}
