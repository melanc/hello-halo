import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { api } from '../../api'
import { isElectron } from '../../api/transport'
import { useTranslation } from '../../i18n'
import '@xterm/xterm/css/xterm.css'

export function XtermTerminal() {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const ptyIdRef = useRef<string | null>(null)
  const disposablesRef = useRef<Array<() => void>>([])

  useEffect(() => {
    if (!isElectron() || !containerRef.current) return

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1e1e2e',
        foreground: '#cdd6f4',
        cursor: '#cdd6f4',
        selectionBackground: '#45475a',
        black: '#45475a',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#f5c2e7',
        cyan: '#94e2d5',
        white: '#bac2de',
        brightBlack: '#585b70',
        brightRed: '#f38ba8',
        brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af',
        brightBlue: '#89b4fa',
        brightMagenta: '#f5c2e7',
        brightCyan: '#94e2d5',
        brightWhite: '#a6adc8',
      },
      allowTransparency: false,
      convertEol: true,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)

    terminalRef.current = term
    fitAddonRef.current = fitAddon

    // Fit terminal first to measure actual cols/rows, then create PTY with correct dimensions
    try { fitAddon.fit() } catch {}

    const initCols = term.cols
    const initRows = term.rows

    // Create PTY session with actual dimensions
    api.ptyCreate({ cols: initCols, rows: initRows }).then((result) => {
      if (result.success && result.data) {
        const id = (result.data as { id: string }).id
        ptyIdRef.current = id

        // Subscribe to PTY data events
        const unsubData = api.onPtyData((ev: unknown) => {
          const { id: evId, data } = ev as { id: string; data: string }
          if (evId === id) {
            term.write(data)
          }
        })

        const unsubExit = api.onPtyExit((ev: unknown) => {
          const { id: evId, exitCode } = ev as { id: string; exitCode: number | null }
          if (evId === id) {
            const message = exitCode === 0
              ? `\r\n\x1b[2m[Process completed]\x1b[0m`
              : `\r\n\x1b[31m[Process exited with code ${exitCode}]\x1b[0m`
            term.write(message)
          }
        })

        disposablesRef.current.push(unsubData, unsubExit)
      }
    })

    // Handle user input → PTY
    const unsubData = term.onData((data: string) => {
      if (ptyIdRef.current) {
        api.ptyWrite({ id: ptyIdRef.current, data })
      }
    })
    disposablesRef.current.push(unsubData)

    // Handle resize
    const unsubResize = term.onResize(({ cols, rows }) => {
      if (ptyIdRef.current) {
        api.ptyResize({ id: ptyIdRef.current, cols, rows })
      }
    })
    disposablesRef.current.push(unsubResize)

    // ResizeObserver for container resize
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit()
      } catch {
        // ignore
      }
    })
    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
      for (const dispose of disposablesRef.current) {
        try { dispose() } catch {}
      }
      disposablesRef.current = []
      if (ptyIdRef.current) {
        api.ptyKill({ id: ptyIdRef.current })
        ptyIdRef.current = null
      }
      try { terminalRef.current?.dispose() } catch {}
      terminalRef.current = null
      fitAddonRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!isElectron()) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm bg-secondary/50">
        {t('Terminal is only available in the desktop app')}
      </div>
    )
  }

  return (
    <div ref={containerRef} className="w-full h-full p-[5px] bg-[#1e1e2e]" />
  )
}
