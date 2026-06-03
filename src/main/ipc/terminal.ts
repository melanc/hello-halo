import { ipcMain, BrowserWindow } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs'
import * as pty from 'node-pty'

const activeProcesses = new Map<string, ChildProcess>()
const activePtyProcesses = new Map<string, pty.IPty>()

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

  // Resolve a cd target relative to the current cwd (main process has path/fs access)
  ipcMain.handle('terminal:cd', (_event, { target, cwd }: { target: string; cwd: string }) => {
    // Expand leading ~ to home directory
    const home = process.env.HOME || process.env.USERPROFILE || '/'
    const expanded = target ? target.replace(/^~(?=$|\/|\\)/, home) : home
    const resolved = path.resolve(cwd, expanded)
    try {
      const stat = fs.statSync(resolved)
      if (stat.isDirectory()) {
        return { success: true, data: { newCwd: resolved } }
      }
      return { success: false, error: `cd: not a directory: ${target}` }
    } catch {
      return { success: false, error: `cd: no such file or directory: ${target}` }
    }
  })

  ipcMain.handle('terminal:kill', (_event, { id }: { id: string }) => {
    const p = activeProcesses.get(id)
    if (p) {
      try { p.kill() } catch {}
      activeProcesses.delete(id)
    }
    return { success: true }
  })

  // === PTY-based terminal (node-pty + xterm.js) ===

  ipcMain.handle('terminal-pty:create', (event, { cols, rows }: { cols?: number; rows?: number } = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash')
    const id = `pty-${Date.now()}`

    const term = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: cols ?? 80,
      rows: rows ?? 24,
      cwd: process.env.HOME,
      env: { ...process.env } as { [key: string]: string },
    })

    activePtyProcesses.set(id, term)

    term.onData((data: string) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('terminal-pty:data', { id, data })
      }
    })

    term.onExit(({ exitCode, signal }) => {
      activePtyProcesses.delete(id)
      if (win && !win.isDestroyed()) {
        win.webContents.send('terminal-pty:exit', { id, exitCode, signal })
      }
    })

    return { success: true, data: { id } }
  })

  ipcMain.handle('terminal-pty:write', (_event, { id, data }: { id: string; data: string }) => {
    const term = activePtyProcesses.get(id)
    if (term) {
      term.write(data)
      return { success: true }
    }
    return { success: false, error: 'PTY not found' }
  })

  ipcMain.handle('terminal-pty:resize', (_event, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
    const term = activePtyProcesses.get(id)
    if (term) {
      term.resize(cols, rows)
      return { success: true }
    }
    return { success: false, error: 'PTY not found' }
  })

  ipcMain.handle('terminal-pty:kill', (_event, { id }: { id: string }) => {
    const term = activePtyProcesses.get(id)
    if (term) {
      term.kill()
      activePtyProcesses.delete(id)
      return { success: true }
    }
    return { success: false, error: 'PTY not found' }
  })
}

export function cleanupTerminalHandlers(): void {
  for (const [id, p] of activeProcesses) {
    try { p.kill() } catch {}
    activeProcesses.delete(id)
  }
  for (const [id, p] of activePtyProcesses) {
    try { p.kill() } catch {}
    activePtyProcesses.delete(id)
  }
}
