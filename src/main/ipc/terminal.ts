import { ipcMain, BrowserWindow } from 'electron'
import { spawn, ChildProcess } from 'child_process'

const activeProcesses = new Map<string, ChildProcess>()

export function registerTerminalHandlers(): void {
  ipcMain.handle('terminal:run', (event, { id, cmd, cwd }: { id: string; cmd: string; cwd?: string }) => {
    // Kill any existing process with same id
    const existing = activeProcesses.get(id)
    if (existing) {
      try { existing.kill() } catch {}
      activeProcesses.delete(id)
    }

    const win = BrowserWindow.fromWebContents(event.sender)
    const shell = process.platform === 'win32' ? 'cmd.exe' : (process.env.SHELL || '/bin/bash')
    const args = process.platform === 'win32' ? ['/c', cmd] : ['-c', cmd]

    const child = spawn(shell, args, {
      cwd: cwd || process.env.HOME,
      env: { ...process.env },
    })

    activeProcesses.set(id, child)

    child.stdout?.on('data', (data: Buffer) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('terminal:output', { id, data: data.toString('utf8'), stream: 'stdout' })
      }
    })

    child.stderr?.on('data', (data: Buffer) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('terminal:output', { id, data: data.toString('utf8'), stream: 'stderr' })
      }
    })

    child.on('close', (code) => {
      activeProcesses.delete(id)
      if (win && !win.isDestroyed()) {
        win.webContents.send('terminal:done', { id, exitCode: code })
      }
    })

    child.on('error', (err) => {
      activeProcesses.delete(id)
      if (win && !win.isDestroyed()) {
        win.webContents.send('terminal:done', { id, exitCode: -1, error: err.message })
      }
    })

    return { success: true }
  })

  ipcMain.handle('terminal:kill', (_event, { id }: { id: string }) => {
    const p = activeProcesses.get(id)
    if (p) {
      try { p.kill() } catch {}
      activeProcesses.delete(id)
    }
    return { success: true }
  })
}

export function cleanupTerminalHandlers(): void {
  for (const [id, p] of activeProcesses) {
    try { p.kill() } catch {}
    activeProcesses.delete(id)
  }
}
