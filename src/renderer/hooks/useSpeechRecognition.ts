/**
 * Web Speech API (Chromium) — continuous dictation with interim + final results.
 * Used for chat voice input; requires network for Google cloud STT in most builds.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/** Map UI locale (i18next) to BCP-47 tag for recognition. */
export function mapUiLangToSpeechLang(i18nLanguage: string): string {
  const l = (i18nLanguage || 'en').trim()
  if (l === 'zh-CN' || l.startsWith('zh-CN')) return 'zh-CN'
  if (l === 'zh-TW' || l === 'zh-HK' || l.startsWith('zh-TW')) return 'zh-TW'
  if (l.startsWith('zh')) return 'zh-CN'
  if (l.startsWith('ja')) return 'ja-JP'
  if (l.startsWith('de')) return 'de-DE'
  if (l.startsWith('es')) return 'es-ES'
  if (l.startsWith('fr')) return 'fr-FR'
  return 'en-US'
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognition) | null {
  if (typeof window === 'undefined') return null
  const w = window as Window & {
    SpeechRecognition?: new () => SpeechRecognition
    webkitSpeechRecognition?: new () => SpeechRecognition
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function isSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionCtor() !== null
}

export interface SpeechRecognitionUpdate {
  /** New finalized segments in this event (order preserved). */
  finals: string[]
  /** Current non-final transcript (whole session’s pending tail). */
  interim: string
}

export interface UseSpeechRecognitionOptions {
  lang: string
  /** Called once per recognition event with new finals and current interim (synchronous). */
  onSpeechUpdate: (update: SpeechRecognitionUpdate) => void
  onError?: (code: string) => void
}

const NETWORK_RETRIES = 2
const networkRetryDelayMs = (attempt: number) => 350 + attempt * 200

export function useSpeechRecognition({
  lang,
  onSpeechUpdate,
  onError,
}: UseSpeechRecognitionOptions): {
  listening: boolean
  interimText: string
  start: () => void
  stop: () => void
  toggle: () => void
} {
  const [listening, setListening] = useState(false)
  const [interimText, setInterimText] = useState('')
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const activeRef = useRef(false)
  const onSpeechUpdateRef = useRef(onSpeechUpdate)
  onSpeechUpdateRef.current = onSpeechUpdate

  const networkFailCountRef = useRef(0)
  const networkRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearNetworkRetry = useCallback(() => {
    if (networkRetryTimeoutRef.current) {
      clearTimeout(networkRetryTimeoutRef.current)
      networkRetryTimeoutRef.current = null
    }
  }, [])

  const stop = useCallback(() => {
    activeRef.current = false
    clearNetworkRetry()
    networkFailCountRef.current = 0
    const r = recognitionRef.current
    recognitionRef.current = null
    if (r) {
      try {
        r.onend = null
        r.stop()
      } catch {
        /* ignore */
      }
    }
    setListening(false)
    setInterimText('')
  }, [clearNetworkRetry])

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) {
      onError?.('not-supported')
      return
    }

    stop()

    activeRef.current = true
    networkFailCountRef.current = 0

    const failSession = (code: string) => {
      clearNetworkRetry()
      activeRef.current = false
      recognitionRef.current = null
      setListening(false)
      setInterimText('')
      onError?.(code)
    }

    const beginRecognition = () => {
      if (!activeRef.current) return
      const ctor = getSpeechRecognitionCtor()
      if (!ctor) {
        failSession('not-supported')
        return
      }

      const r = new ctor()
      r.continuous = true
      r.interimResults = true
      r.lang = lang

      r.onresult = (event: SpeechRecognitionEvent) => {
        networkFailCountRef.current = 0

        // Scan only from resultIndex so stale non-final entries from earlier
        // in the session (before the current change) are not re-included.
        let interim = ''
        const finals: string[] = []
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const res = event.results[i]
          if (res.isFinal) {
            const piece = res[0]?.transcript
            if (piece) finals.push(piece)
          } else {
            interim += res[0]?.transcript ?? ''
          }
        }
        const interimTrim = interim.trim()
        setInterimText(interimTrim)

        onSpeechUpdateRef.current?.({ finals, interim: interimTrim })
      }

      r.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (event.error === 'aborted') return
        if (event.error === 'no-speech') return

        if (event.error === 'not-allowed') {
          failSession('not-allowed')
          return
        }

        if (event.error === 'network' && activeRef.current) {
          try {
            r.onend = null
            r.stop()
          } catch {
            /* ignore */
          }
          recognitionRef.current = null

          networkFailCountRef.current += 1
          if (networkFailCountRef.current <= NETWORK_RETRIES) {
            clearNetworkRetry()
            const attempt = networkFailCountRef.current
            networkRetryTimeoutRef.current = setTimeout(() => {
              networkRetryTimeoutRef.current = null
              if (!activeRef.current) return
              beginRecognition()
            }, networkRetryDelayMs(attempt))
            return
          }

          failSession('network')
          return
        }

        failSession(event.error)
      }

      r.onend = () => {
        if (!activeRef.current) {
          setListening(false)
          return
        }
        try {
          r.start()
        } catch {
          activeRef.current = false
          recognitionRef.current = null
          setListening(false)
          setInterimText('')
        }
      }

      recognitionRef.current = r
      try {
        r.start()
        setListening(true)
      } catch {
        recognitionRef.current = null
        failSession('start-failed')
      }
    }

    beginRecognition()
  }, [lang, onError, stop, clearNetworkRetry])

  const toggle = useCallback(() => {
    if (activeRef.current) stop()
    else start()
  }, [start, stop])

  useEffect(() => () => stop(), [stop])

  return { listening, interimText, start, stop, toggle }
}
