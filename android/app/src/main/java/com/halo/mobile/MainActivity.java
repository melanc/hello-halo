package com.halo.mobile;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register custom plugins before super.onCreate()
        registerPlugin(ForegroundServicePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
