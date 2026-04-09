/**
 * Offline speech-to-text via whisper.cpp CLI (bundled or user-configured paths).
 * Expects 16-bit mono WAV; language tags follow whisper.cpp -l values.
 */

import { spawn } from 'child_process'
import { existsSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { app } from 'electron'
import { getConfig } from './config.service'

export interface OfflineSpeechStatus {
  available: boolean
  binaryPath: string | null
  modelPath: string | null
  reason?: 'disabled' | 'no-binary' | 'no-model' | 'binary-missing' | 'model-missing'
}

function bundledWhisperBin(): string | null {
  const name = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
  const p = join(process.resourcesPath, 'whisper', name)
  return existsSync(p) ? p : null
}

function bundledModel(): string | null {
  const p = join(process.resourcesPath, 'whisper', 'ggml-base.bin')
  return existsSync(p) ? p : null
}

export function resolveWhisperPaths(): { bin: string | null; model: string | null } {
  const c = getConfig().offlineSpeech
  const envBin = process.env.WHISPER_CPP_BIN?.trim()
  const envModel = process.env.WHISPER_CPP_MODEL?.trim()

  let bin = (c?.whisperBinPath?.trim() || envBin || '') || null
  let model = (c?.whisperModelPath?.trim() || envModel || '') || null

  if (!bin && app.isPackaged) {
    bin = bundledWhisperBin()
  }
  if (!model && app.isPackaged) {
    model = bundledModel()
  }

  if (bin && !existsSync(bin)) bin = null
  if (model && !existsSync(model)) model = null

  return { bin, model }
}

export function getOfflineSpeechStatus(): OfflineSpeechStatus {
  const cfg = getConfig().offlineSpeech
  if (!cfg?.enabled) {
    return { available: false, binaryPath: null, modelPath: null, reason: 'disabled' }
  }

  const { bin, model } = resolveWhisperPaths()
  if (!bin) {
    return { available: false, binaryPath: null, modelPath: model, reason: 'no-binary' }
  }
  if (!model) {
    return { available: false, binaryPath: bin, modelPath: null, reason: 'no-model' }
  }
  return { available: true, binaryPath: bin, modelPath: model }
}

export function whisperLanguageTag(i18nLanguage: string): string {
  const l = (i18nLanguage || 'en').trim().toLowerCase()
  if (l.startsWith('zh')) return 'zh'
  if (l.startsWith('ja')) return 'ja'
  if (l.startsWith('de')) return 'de'
  if (l.startsWith('es')) return 'es'
  if (l.startsWith('fr')) return 'fr'
  return 'en'
}

export async function transcribeWavBuffer(
  wavBuffer: Buffer,
  languageTag: string
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const { bin, model } = resolveWhisperPaths()
  const cfg = getConfig().offlineSpeech
  if (!cfg?.enabled) {
    return { ok: false, error: 'disabled' }
  }
  if (!bin || !model) {
    return { ok: false, error: !bin ? 'no-binary' : 'no-model' }
  }

  const tmp = join(app.getPath('temp'), `devx-whisper-${randomUUID()}.wav`)
  writeFileSync(tmp, wavBuffer)

  const args = ['-m', model, '-f', tmp, '-l', languageTag, '-nt']

  return new Promise((resolve) => {
    const proc = spawn(bin, args, {
      windowsHide: true,
      env: { ...process.env, WHISPER_CPP_NUM_THREADS: process.env.WHISPER_CPP_NUM_THREADS || '4' },
    })

    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGTERM')
      } catch {
        /* ignore */
      }
      try {
        unlinkSync(tmp)
      } catch {
        /* ignore */
      }
      resolve({ ok: false, error: 'timeout' })
    }, 120_000)

    proc.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString('utf8')
    })
    proc.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString('utf8')
    })
    proc.on('error', (err) => {
      clearTimeout(timer)
      try {
        unlinkSync(tmp)
      } catch {
        /* ignore */
      }
      resolve({ ok: false, error: err.message })
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      try {
        unlinkSync(tmp)
      } catch {
        /* ignore */
      }
      if (code !== 0) {
        const tail = stderr.trim().slice(-800) || stdout.trim().slice(-800) || `exit ${code}`
        resolve({ ok: false, error: tail })
        return
      }
      const text = stdout
        .split('\n')
        .map((line) => line.replace(/^\[[^\]]+\]\s*/g, '').trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      resolve({ ok: true, text })
    })
  })
}
