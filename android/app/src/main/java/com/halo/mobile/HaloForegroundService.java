package com.halo.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.app.NotificationCompat;

/**
 * Android Foreground Service to keep the WebView process alive in the background.
 *
 * When the Halo app is connected to a desktop server, this service prevents Android
 * from suspending the WebView and killing the WebSocket connection. This ensures
 * real-time event delivery (task completion, digital human notifications, escalations)
 * even when the user switches to another app.
 *
 * The service shows a persistent notification: "Halo · Connected to desktop"
 * which is standard behavior for foreground services (similar to messaging apps).
 */
public class HaloForegroundService extends Service {

    private static final String TAG = "HaloForegroundService";
    private static final String CHANNEL_ID = "halo_connection_channel";
    private static final int NOTIFICATION_ID = 1001;

    private PowerManager.WakeLock wakeLock;

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "Service created");
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.d(TAG, "Service started");

        // Build the persistent notification
        Intent notificationIntent = new Intent(this, MainActivity.class);
        notificationIntent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this, 0, notificationIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // Extract custom title/body from intent (with defaults)
        String title = "Halo";
        String body = "Connected to desktop";
        if (intent != null) {
            if (intent.hasExtra("title")) title = intent.getStringExtra("title");
            if (intent.hasExtra("body")) body = intent.getStringExtra("body");
        }

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(getSmallIconResource())
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build();

        // Start foreground with appropriate type for Android 14+ (API 34+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        // Acquire a partial wake lock to keep CPU running for WebSocket heartbeats
        acquireWakeLock();

        // If the system kills this service, restart it
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        Log.d(TAG, "Service destroyed");
        releaseWakeLock();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createNotificationChannel() {
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Halo Connection",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Keeps connection to Halo desktop alive for real-time notifications");
        channel.setShowBadge(false);

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.createNotificationChannel(channel);
        }
    }

    private void acquireWakeLock() {
        if (wakeLock == null) {
            PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
            if (powerManager != null) {
                wakeLock = powerManager.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    "Halo::ConnectionKeepAlive"
                );
                // Auto-release after 4 hours to prevent battery drain if something goes wrong
                wakeLock.acquire(4 * 60 * 60 * 1000L);
                Log.d(TAG, "WakeLock acquired");
            }
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
            wakeLock = null;
            Log.d(TAG, "WakeLock released");
        }
    }

    private int getSmallIconResource() {
        // Try to use custom notification icon, fall back to app icon
        int iconRes = getResources().getIdentifier("ic_notification", "drawable", getPackageName());
        if (iconRes == 0) {
            iconRes = getResources().getIdentifier("ic_launcher", "mipmap", getPackageName());
        }
        return iconRes;
    }
}
