/**
 * Global type declarations for renderer process
 * Extends Window interface with Electron preload APIs
 */

declare global {
  interface Window {
    platform?: {
      platform: 'darwin' | 'win32' | 'linux'
      isMac: boolean
      isWindows: boolean
      isLinux: boolean
    }
  }
}

export {}
