/**
 * Live microphone level / spectrum bars while mounted (speech input listening).
 * Uses getUserMedia + AnalyserNode (separate from Web Speech API).
 */

import { useEffect, useRef } from 'react'

type SpeechVolumeMeterProps = {
  className?: string
}

/** Sized to sit beside the 32px mic control in the input toolbar */
const BAR_COUNT = 11
const CSS_W = 76
const CSS_H = 24

function readPrimaryParts(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '217 91% 60%'
}

export function SpeechVolumeMeter({ className }: SpeechVolumeMeterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let cancelled = false
    let stream: MediaStream | null = null
    let audioCtx: AudioContext | null = null

    const stopAll = () => {
      cancelled = true
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
      stream?.getTracks().forEach((t) => t.stop())
      stream = null
      void audioCtx?.close()
      audioCtx = null
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, canvas.width, canvas.height)
      }
    }

    const run = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        })
      } catch {
        return
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }

      try {
        audioCtx = new AudioContext()
        if (audioCtx.state === 'suspended') await audioCtx.resume()
      } catch {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      if (cancelled) {
        stopAll()
        return
      }

      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.62
      analyser.minDecibels = -85
      analyser.maxDecibels = -25
      source.connect(analyser)

      const freq = new Uint8Array(analyser.frequencyBinCount)
      const dpr = Math.min(window.devicePixelRatio ?? 1, 2)
      canvas.width = Math.floor(CSS_W * dpr)
      canvas.height = Math.floor(CSS_H * dpr)
      canvas.style.width = `${CSS_W}px`
      canvas.style.height = `${CSS_H}px`

      const primary = readPrimaryParts()
      const gap = 1.5
      const barW = (CSS_W - gap * (BAR_COUNT + 1)) / BAR_COUNT

      const draw = () => {
        if (cancelled || !canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        analyser.getByteFrequencyData(freq)
        const step = Math.max(1, Math.floor(freq.length / BAR_COUNT))

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, CSS_W, CSS_H)

        const baseH = 2
        const maxBar = CSS_H - gap * 2 - baseH

        for (let i = 0; i < BAR_COUNT; i++) {
          let peak = 0
          const start = i * step
          for (let j = 0; j < step && start + j < freq.length; j++) {
            peak = Math.max(peak, freq[start + j] ?? 0)
          }
          const norm = peak / 255
          const barH = baseH + norm * maxBar
          const x = gap + i * (barW + gap)
          const y = CSS_H - gap - barH

          const g = ctx.createLinearGradient(x, y + barH, x, y)
          g.addColorStop(0, `hsl(${primary} / 0.35)`)
          g.addColorStop(0.55, `hsl(${primary} / 0.72)`)
          g.addColorStop(1, `hsl(${primary} / 0.95)`)
          ctx.fillStyle = g
          const r = Math.min(2, barW / 2)
          ctx.beginPath()
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(x, y, barW, barH, r)
          } else {
            ctx.rect(x, y, barW, barH)
          }
          ctx.fill()
        }

        rafRef.current = requestAnimationFrame(draw)
      }

      draw()
    }

    void run()

    return () => {
      stopAll()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden
      width={CSS_W}
      height={CSS_H}
    />
  )
}
