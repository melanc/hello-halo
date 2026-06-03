/**
 * platform/memory -- Daily Log
 *
 * A continuous daily work log.
 * The AI maintains it via system prompt instructions; the backend
 * provides path utilities, context loading, and background consolidation.
 *
 * Layout:
 *   {globalMemoryDir}/logs/
 *     2026/
 *       05/
 *         2026-05-11.md    ← one file per day
 *
 * Format (maintained by AI):
 *   # 2026-05-11 Work Log
 *
 *   ## 10:30 — Summary title
 *   - Bullet points of work done
 *   - Key decisions or findings
 */

import { readFile, appendFile, mkdir, readdir, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { getGlobalMemoryDir } from './paths'

// ============================================================================
// Path Utilities
// ============================================================================

/**
 * Get the daily log root directory.
 * Path: {haloDir}/memory/logs/
 */
export function getDailyLogDir(): string {
  return join(getGlobalMemoryDir(), 'logs')
}

/**
 * Format a date as YYYY-MM-DD.
 */
function formatDate(date: Date): string {
  const y = date.getFullYear()
  const m = (date.getMonth() + 1).toString().padStart(2, '0')
  const d = date.getDate().toString().padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Get the path to a specific day's log file.
 *
 * @param dateStr - Date string in YYYY-MM-DD format (default: today)
 * @returns Absolute path to the log file
 */
export function getDailyLogPath(dateStr?: string): string {
  const date = dateStr || formatDate(new Date())
  const [y, m] = date.split('-')
  return join(getDailyLogDir(), y, m, `${date}.md`)
}

/**
 * Ensure the daily log directory structure exists for a given date.
 *
 * @param dateStr - Date string in YYYY-MM-DD format (default: today)
 */
export async function ensureDailyLogDirs(dateStr?: string): Promise<void> {
  const dir = join(getDailyLogDir(), dirname(dateStr || formatDate(new Date())))
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true })
  }
}

/** Extract the directory portion of a date path (YYYY/MM) */
function dirname(dateStr: string): string {
  const parts = dateStr.split('-')
  return join(parts[0], parts[1])
}

// ============================================================================
// Read / Append
// ============================================================================

/**
 * Read a specific day's daily log.
 *
 * @param dateStr - Date string in YYYY-MM-DD format (default: today)
 * @returns File content, or null if no log exists for that day
 */
export async function readDailyLog(dateStr?: string): Promise<string | null> {
  const filePath = getDailyLogPath(dateStr)
  try {
    return await readFile(filePath, 'utf-8')
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

/**
 * Read daily logs for the last N days.
 *
 * @param days - Number of days to look back (default: 3)
 * @returns Array of { date, content } sorted newest first
 */
export async function readRecentDailyLogs(days: number = 3): Promise<Array<{ date: string; content: string }>> {
  const results: Array<{ date: string; content: string }> = []
  const now = new Date()

  for (let i = 0; i < days; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const dateStr = formatDate(d)
    const content = await readDailyLog(dateStr)
    if (content !== null) {
      results.push({ date: dateStr, content })
    }
  }

  return results
}

/**
 * Append a timestamped entry to today's daily log.
 * Creates the file and directories if they don't exist.
 *
 * @param title - Entry title (e.g., "Memory analysis completed")
 * @param body  - Bullet points or body text
 * @returns The full path of the log file
 */
export async function appendToDailyLog(title: string, body: string): Promise<string> {
  const dateStr = formatDate(new Date())
  const filePath = getDailyLogPath(dateStr)
  await ensureDailyLogDirs(dateStr)

  const now = new Date()
  const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
  const entry = `\n## ${time} — ${title}\n${body.trimEnd()}\n`

  if (existsSync(filePath)) {
    await appendFile(filePath, entry, 'utf-8')
  } else {
    const header = `# ${dateStr} Work Log\n`
    await appendFile(filePath, header + entry.trimStart(), 'utf-8')
  }

  return filePath
}

// ============================================================================
// Context Building (for injection into system prompt)
// ============================================================================

/**
 * Build a formatted string of recent daily logs for injection into
 * the system prompt context.
 *
 * Shows the last N days of logs, truncated to a total character limit.
 *
 * @param days - Number of days to include (default: 3)
 * @param maxChars - Maximum total characters (default: 4000)
 * @returns Formatted markdown string, or null if no logs found
 */
export async function buildDailyLogContext(days: number = 3, maxChars: number = 4000): Promise<string | null> {
  const logs = await readRecentDailyLogs(days)
  if (logs.length === 0) return null

  const parts: string[] = ['## Recent Work Logs', '']
  let totalChars = 0

  for (const { date, content } of logs) {
    const header = `### ${date}\n`
    const remaining = maxChars - totalChars - header.length - 50 // buffer

    if (remaining <= 0) break

    if (content.length <= remaining) {
      parts.push(header + content.trimEnd())
      totalChars += header.length + content.length
    } else {
      // Truncate long log entries
      const truncated = content.slice(0, remaining - 100) + `\n\n_(truncated, ${content.length - remaining + 100} more chars)_`
      parts.push(header + truncated.trimEnd())
      totalChars += header.length + truncated.length
    }
    parts.push('')
  }

  return parts.join('\n')
}
