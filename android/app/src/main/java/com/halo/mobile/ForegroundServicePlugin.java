package com.halo.mobile;

import android.content.Intent;
import android.os.Build;
import android.util.Log;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Capacitor plugin to control the HaloForegroundService from JavaScript.
 *
 * Provides start() and stop() methods that the WebSocket transport layer
 * calls to keep the connection alive when the app goes to background.
 */
@CapacitorPlugin(name = "ForegroundService")
public class ForegroundServicePlugin extends Plugin {

    private static final String TAG = "ForegroundServicePlugin";

    @PluginMethod()
    public void start(PluginCall call) {
        String title = call.getString("title", "Halo");
        String body = call.getString("body", "Connected to desktop");

        Log.d(TAG, "Starting foreground service: " + title + " - " + body);

        try {
            Intent serviceIntent = new Intent(getContext(), HaloForegroundService.class);
            serviceIntent.putExtra("title", title);
            serviceIntent.putExtra("body", body);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(serviceIntent);
            } else {
                getContext().startService(serviceIntent);
            }

            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Failed to start foreground service", e);
            call.reject("Failed to start foreground service: " + e.getMessage());
        }
    }

    @PluginMethod()
    public void stop(PluginCall call) {
        Log.d(TAG, "Stopping foreground service");

        try {
            Intent serviceIntent = new Intent(getContext(), HaloForegroundService.class);
            getContext().stopService(serviceIntent);
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Failed to stop foreground service", e);
            call.reject("Failed to stop foreground service: " + e.getMessage());
        }
    }
}
