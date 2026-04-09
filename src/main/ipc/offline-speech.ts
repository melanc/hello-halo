/**
 * IPC: offline whisper.cpp transcription + optional file picker for settings.
 */

import { ipcMain, dialog, type FileFilter } from 'electron'
import { getOfflineSpeechStatus, transcribeWavBuffer, whisperLanguageTag } from '../services/offline-speech.service'

export function registerOfflineSpeechHandlers(): void {
  ipcMain.handle('offline-speech:status', async () => {
    try {
      const data = getOfflineSpeechStatus()
      return { success: true, data }
    } catch (e) {
      const err = e as Error
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle(
    'offline-speech:transcribe',
    async (_event, payload: { wavBytes: ArrayBuffer; i18nLanguage: string }) => {
      try {
        const buf = Buffer.from(new Uint8Array(payload.wavBytes))
        const lang = whisperLanguageTag(payload.i18nLanguage || 'en')
        const result = await transcribeWavBuffer(buf, lang)
        if (result.ok) {
          return { success: true, data: { text: result.text } }
        }
        return { success: false, error: result.error }
      } catch (e) {
        const err = e as Error
        return { success: false, error: err.message }
      }
    }
  )

  ipcMain.handle('offline-speech:browse-file', async (_event, opts: { title?: string; filters?: FileFilter[] }) => {
    const result = await dialog.showOpenDialog({
      title: opts?.title,
      properties: ['openFile'],
      filters: opts?.filters ?? [{ name: 'All Files', extensions: ['*'] }],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { success: true, data: { path: null as string | null } }
    }
    return { success: true, data: { path: result.filePaths[0] } }
  })
}
