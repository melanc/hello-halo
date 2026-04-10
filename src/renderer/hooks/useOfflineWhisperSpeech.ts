/**
 * Offline dictation: capture mic, VAD chunking, WAV to main process whisper.cpp.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { isElectron } from '../api/transport'
import {
  buildWavFromMono16BitPcm,
  floatTo16BitPCM,
  resampleFloat32,
} from '../utils/audioWav'
import type { SpeechRecognitionUpdate } from './useSpeechRecognition'

const TARGET_RATE = 16_000
const VAD_INTERVAL_MS = 120
const MIN_AUDIO_SEC = 0.42
const SILENCE_MS = 560
const RMS_THRESHOLD = 0.014

function mergeChunks(chunks: Float32Array[]): Float32Array {
  let len = 0
  for (const c of chunks) len += c.length
  const out = new Float32Array(len)
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}

function computeRms(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let s = 0
  for (let i = 0; i < samples.length; i++) s += samples[i] * samples[i]
  return Math.sqrt(s / samples.length)
}

export function useOfflineWhisperSpeech(options: {
  i18nLanguage: string
  onSpeechUpdate: (update: SpeechRecognitionUpdate) => void
  onError: (code: string) => void
}): {
  listening: boolean
  stream: MediaStream | null
  start: () => Promise<void>
  stop: () => void
} {
  const [listening, setListening] = useState(false)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const activeRef = useRef(false)
  const chunksRef = useRef<Float32Array[]>([])
  const inputRateRef = useRef(48000)
  const hadSpeechRef = useRef(false)
  const silenceMsRef = useRef(0)
  const flushingRef = useRef(false)
  const vadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const optsRef = useRef(options)
  optsRef.current = options

  const transcribeMerged = useCallback(async (merged: Float32Array, rate: number) => {
    const minSamples = Math.floor(rate * MIN_AUDIO_SEC)
    if (merged.length < minSamples) return
    if (flushingRef.current) return
    flushingRef.current = true
    try {
      const resampled = resampleFloat32(merged, rate, TARGET_RATE)
      const pcm = floatTo16BitPCM(resampled)
      const wav = buildWavFromMono16BitPcm(pcm, TARGET_RATE)
      const ab = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength)

      const resp = await api.offlineSpeechTranscribe({
        wavBytes: ab,
        i18nLanguage: optsRef.current.i18nLanguage,
      })

      if (!resp.success) {
        optsRef.current.onError(resp.error || 'transcribe-failed')
        return
      }
      const text = (resp.data as { text?: string })?.text?.trim() ?? ''
      if (text) {
        optsRef.current.onSpeechUpdate({ finals: [text], interim: '' })
      }
    } catch (e) {
      optsRef.current.onError((e as Error).message || 'transcribe-failed')
    } finally {
      flushingRef.current = false
    }
  }, [])

  const runVadTick = useCallback(() => {
    if (!activeRef.current) return
    if (chunksRef.current.length === 0) return

    const merged = mergeChunks(chunksRef.current)
    const rate = inputRateRef.current
    const win = Math.max(64, Math.floor(rate * 0.045))
    const tail = merged.subarray(Math.max(0, merged.length - win))
    const rms = computeRms(tail)

    if (rms > RMS_THRESHOLD) {
      hadSpeechRef.current = true
      silenceMsRef.current = 0
    } else {
      silenceMsRef.current += VAD_INTERVAL_MS
    }

    if (
      hadSpeechRef.current &&
      silenceMsRef.current >= SILENCE_MS &&
      merged.length >= Math.floor(rate * MIN_AUDIO_SEC)
    ) {
      hadSpeechRef.current = false
      silenceMsRef.current = 0
      chunksRef.current = []
      void transcribeMerged(merged, rate)
    }
  }, [transcribeMerged])

  const stop = useCallback(() => {
    activeRef.current = false
    if (vadTimerRef.current) {
      clearInterval(vadTimerRef.current)
      vadTimerRef.current = null
    }
    try {
      processorRef.current?.disconnect()
    } catch {
      /* ignore */
    }
    try {
      gainRef.current?.disconnect()
    } catch {
      /* ignore */
    }
    processorRef.current = null
    gainRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    void ctxRef.current?.close()
    ctxRef.current = null

    const merged = mergeChunks(chunksRef.current)
    chunksRef.current = []
    const rate = inputRateRef.current
    setListening(false)
    setStream(null)

    if (merged.length >= Math.floor(rate * MIN_AUDIO_SEC)) {
      void transcribeMerged(merged, rate)
    }
  }, [transcribeMerged])

  const start = useCallback(async () => {
    if (!isElectron()) {
      optsRef.current.onError('not-electron')
      return
    }
    stop()
    activeRef.current = true
    chunksRef.current = []
    hadSpeechRef.current = false
    silenceMsRef.current = 0

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })
    } catch {
      optsRef.current.onError('not-allowed')
      return
    }

    streamRef.current = stream
    setStream(stream)
    const audioCtx = new AudioContext()
    ctxRef.current = audioCtx
    inputRateRef.current = audioCtx.sampleRate

    const source = audioCtx.createMediaStreamSource(stream)
    const processor = audioCtx.createScriptProcessor(4096, 1, 1)
    processorRef.current = processor

    processor.onaudioprocess = (e) => {
      if (!activeRef.current) return
      const ch0 = e.inputBuffer.getChannelData(0)
      chunksRef.current.push(new Float32Array(ch0))
    }

    const gain = audioCtx.createGain()
    gain.gain.value = 0
    gainRef.current = gain
    source.connect(processor)
    processor.connect(gain)
    gain.connect(audioCtx.destination)

    vadTimerRef.current = setInterval(runVadTick, VAD_INTERVAL_MS)
    setListening(true)
  }, [stop, runVadTick])

  useEffect(() => () => stop(), [stop])

  return { listening, stream, start, stop }
}
