import { useState, useRef, useEffect, useCallback, KeyboardEvent } from 'react'
import { X, Play, Square } from 'lucide-react'
import { api } from '../../api'
import { isElectron } from '../../api/transport'
import { useTranslation } from '../../i18n'

interface CommandPanelProps {
  onClose: () => void
  /** Optional working directory override passed to the shell */
  cwd?: string
}

interface OutputLine {
  text: string
  stream: 'stdout' | 'stderr' | 'system'
}

const ANSI_STRIP = /\x1B\[[0-9;]*[a-zA-Z]/g

function stripAnsi(str: string): string {
  return str.replace(ANSI_STRIP, '')
}

export function CommandPanel({ onClose, cwd }: CommandPanelProps) {
  const { t } = useTranslation()
  const [cmd, setCmd] = useState('')
  const [lines, setLines] = useState<OutputLine[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  const [historyIdx, setHistoryIdx] = useState(-1)

  const runIdRef = useRef(`cmd-${Date.now()}`)
  const outputEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-scroll to bottom when new output arrives
  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  // Subscribe to terminal events
  useEffect(() => {
    const unsubOutput = api.onTerminalOutput((ev: unknown) => {
      const { id, data, stream } = ev as { id: string; data: string; stream: 'stdout' | 'stderr' }
      if (id !== runIdRef.current) return
      const chunks = stripAnsi(data).split('\n')
      if (chunks[chunks.length - 1] === '') chunks.pop()
      if (chunks.length === 0) return
      setLines((prev) => [...prev, ...chunks.map((t) => ({ text: t, stream }))])
    })

    const unsubDone = api.onTerminalDone((ev: unknown) => {
      const { id, exitCode } = ev as { id: string; exitCode: number | null }
      if (id !== runIdRef.current) return
      setIsRunning(false)
      setLines((prev) => [
        ...prev,
        {
          text: exitCode === 0 || exitCode === null
            ? t('[Done]')
            : `${t('[Exited with code')} ${exitCode}]`,
          stream: 'system',
        },
      ])
    })

    return () => {
      unsubOutput()
      unsubDone()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleRun = useCallback(() => {
    const trimmed = cmd.trim()
    if (!trimmed || isRunning) return

    // New run id per command
    runIdRef.current = `cmd-${Date.now()}`

    setLines((prev) => [
      ...prev,
      { text: `$ ${trimmed}`, stream: 'system' },
    ])
    setHistory((prev) => [trimmed, ...prev.slice(0, 49)])
    setHistoryIdx(-1)
    setCmd('')
    setIsRunning(true)

    void api.terminalRun({ id: runIdRef.current, cmd: trimmed, cwd })
  }, [cmd, cwd, isRunning])

  const handleStop = useCallback(() => {
    void api.terminalKill({ id: runIdRef.current })
    setIsRunning(false)
    setLines((prev) => [...prev, { text: t('[Killed]'), stream: 'system' }])
  }, [t])

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleRun()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const next = Math.min(historyIdx + 1, history.length - 1)
      setHistoryIdx(next)
      if (history[next] !== undefined) setCmd(history[next])
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = Math.max(historyIdx - 1, -1)
      setHistoryIdx(next)
      setCmd(next === -1 ? '' : history[next] ?? '')
    }
  }

  if (!isElectron()) {
    return (
      <div className="flex items-center justify-center h-24 text-muted-foreground text-sm rounded-2xl bg-secondary/50">
        {t('Terminal is only available in the desktop app')}
      </div>
    )
  }

  return (
    <div className="flex flex-col rounded-2xl overflow-hidden bg-[#1e1e2e] ring-1 ring-white/10">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10 shrink-0">
        <span className="text-[11px] text-white/40 font-mono select-none">Terminal</span>
        <button
          onClick={onClose}
          className="text-white/40 hover:text-white/80 transition-colors"
          title={t('Close terminal')}
        >
          <X size={13} />
        </button>
      </div>

      {/* Output area */}
      <div className="overflow-y-auto px-3 py-2 font-mono text-[12px] leading-[1.6]" style={{ minHeight: 160, maxHeight: 280 }}>
        {lines.map((line, i) => (
          <div
            key={i}
            className={
              line.stream === 'stderr'
                ? 'text-red-400/90'
                : line.stream === 'system'
                  ? 'text-white/30'
                  : 'text-[#cdd6f4]'
            }
          >
            {line.text || '\u00a0'}
          </div>
        ))}
        <div ref={outputEndRef} />
      </div>

      {/* Input bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-white/10 shrink-0">
        <span className="text-white/30 font-mono text-[12px] select-none shrink-0">$</span>
        <input
          ref={inputRef}
          type="text"
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('Enter command...')}
          disabled={isRunning}
          className="flex-1 bg-transparent text-[#cdd6f4] font-mono text-[12px] outline-none
            placeholder:text-white/20 disabled:opacity-50"
          autoFocus
        />
        {isRunning ? (
          <button
            onClick={handleStop}
            className="shrink-0 text-red-400/70 hover:text-red-400 transition-colors"
            title={t('Stop')}
          >
            <Square size={13} />
          </button>
        ) : (
          <button
            onClick={handleRun}
            disabled={!cmd.trim()}
            className="shrink-0 text-white/30 hover:text-white/70 transition-colors disabled:opacity-30"
            title={t('Run')}
          >
            <Play size={13} />
          </button>
        )}
      </div>
    </div>
  )
}
