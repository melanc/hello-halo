/**
 * Capacitor ForegroundService Plugin Bridge
 *
 * TypeScript interface for the native Android ForegroundServicePlugin.
 * Controls the foreground service that keeps WebSocket connections alive
 * when the app is in the background.
 *
 * Only available in Capacitor mode — no-ops in Electron/Remote.
 */

import { isCapacitor } from './transport'

interface ForegroundServicePlugin {
  start(options: { title: string; body: string }): Promise<void>
  stop(): Promise<void>
}

let _plugin: ForegroundServicePlugin | null = null
let _started = false

/**
 * Lazily load the Capacitor plugin.
 * Returns null if not in Capacitor mode or plugin is unavailable.
 */
async function getPlugin(): Promise<ForegroundServicePlugin | null> {
  if (!isCapacitor()) return null
  if (_plugin) return _plugin

  try {
    const { registerPlugin } = await import('@capacitor/core')
    _plugin = registerPlugin<ForegroundServicePlugin>('ForegroundService')
    return _plugin
  } catch (err) {
    console.warn('[ForegroundService] Plugin not available:', err)
    return null
  }
}

/**
 * Start the foreground service with a persistent notification.
 * Call this when WebSocket connects to a server.
 */
export async function startForegroundService(title: string, body: string): Promise<void> {
  if (_started) return
  const plugin = await getPlugin()
  if (!plugin) return

  try {
    await plugin.start({ title, body })
    _started = true
    console.log('[ForegroundService] Started')
  } catch (err) {
    console.warn('[ForegroundService] Failed to start:', err)
  }
}

/**
 * Stop the foreground service.
 * Call this when WebSocket disconnects or user explicitly disconnects.
 */
export async function stopForegroundService(): Promise<void> {
  if (!_started) return
  const plugin = await getPlugin()
  if (!plugin) return

  try {
    await plugin.stop()
    _started = false
    console.log('[ForegroundService] Stopped')
  } catch (err) {
    console.warn('[ForegroundService] Failed to stop:', err)
  }
}

/**
 * Check if the foreground service is currently running.
 */
export function isForegroundServiceRunning(): boolean {
  return _started
}
