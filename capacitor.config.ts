import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.halo.mobile',
  appName: 'Halo',
  // Vite mobile build output directory
  webDir: 'dist-mobile',
  // Server configuration: load from local assets (not a remote URL)
  server: {
    // Allow mixed content for connecting to HTTP servers on LAN
    androidScheme: 'https',
    // Allow navigation to any origin (needed for WebSocket connections)
    allowNavigation: ['*']
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 500,
      backgroundColor: '#0a0a0a',
      showSpinner: false
    },
    Keyboard: {
      // Resize content when keyboard appears
      resize: 'body' as any,
      resizeOnFullScreen: true
    },
    LocalNotifications: {
      // Use default notification channel
      smallIcon: 'ic_notification',
      iconColor: '#3b82f6'
    }
  },
  android: {
    // Allow cleartext traffic for LAN connections (http://)
    allowMixedContent: true,
    // Background mode: keep WebSocket alive
    backgroundColor: '#0a0a0a'
  }
}

export default config
