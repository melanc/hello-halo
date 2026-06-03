/**
 * platform/memory -- Daily Log Consolidation
 *
 * Background process that tracks daily log growth and maintains
 * consolidation state (line-count tracking) to avoid re-processing.
 *
 * Design:
 * - Fire-and-forget: never blocks the main conversation flow
 * - Line-count tracking: only processes NEW log entries since last consolidation
 * - Tracks processed lines to enable future model-based extraction
 */

import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join, basename } from 'path'
import { readDailyLog, getDailyLogDir } from './dailylog'
import { replaceMemoryFile } from './file-ops'
import type { ApiCredentials } from '../../services/agent/types'

// ============================================================================
// Constants
// ============================================================================

/** Minimum new lines in the log to trigger consolidation */
const MIN_NEW_LINES = 3

// ============================================================================
// Tracking
// ============================================================================

/**
 * Tracking file stores the last consolidated line count per log file.
 * Format: { "2026-05-11.md": 42, "2026-05-10.md": 100 }
 */
interface ConsolidationState {
  [logFileName: string]: number // line count of last consolidated content
}

function getTrackingFilePath(): string {
  return join(getDailyLogDir(), '.consolidated.json')
}

/** Minimum interval between consolidations (5 minutes) */
const CONSOLIDATION_COOLDOWN_MS = 5 * 60 * 1000
let lastConsolidationTime = 0

async function readConsolidationState(): Promise<ConsolidationState> {
  try {
    const raw = await readFile(getTrackingFilePath(), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

async function writeConsolidationState(state: ConsolidationState): Promise<void> {
  await replaceMemoryFile(getTrackingFilePath(), JSON.stringify(state, null, 2) + '\n')
}

function getLogFileName(dateStr?: string): string {
  const d = dateStr || (() => {
    const now = new Date()
    const y = now.getFullYear()
    const m = (now.getMonth() + 1).toString().padStart(2, '0')
    const d2 = now.getDate().toString().padStart(2, '0')
    return `${y}-${m}-${d2}`
  })()
  return `${d}.md`
}

// ============================================================================
// Consolidation
// ============================================================================

/**
 * Check which lines in a log file are new since last consolidation.
 *
 * @returns The new content, or null if nothing new
 */
function findNewLogContent(
  logContent: string,
  state: ConsolidationState,
  logFileName: string,
): string | null {
  const lines = logContent.split('\n')
  const lastProcessedLine = state[logFileName] || 0

  if (lines.length <= lastProcessedLine) return null

  const newLines = lines.slice(lastProcessedLine)
  const newText = newLines.join('\n').trim()

  if (newLines.length < MIN_NEW_LINES || !newText) return null

  return newText
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Consolidate today's daily log.
 *
 * Reads today's daily log, finds unprocessed entries (via line-count tracking),
 * and updates the tracking state to avoid re-processing.
 *
 * Fire-and-forget: callers should NOT await this function.
 *
 * @param _credentials - API credentials (reserved for future use)
 * @param _signal - Optional abort signal (reserved for future use)
 * @returns Result with count of processed entries
 */
export async function consolidateDailyLog(
  _credentials: ApiCredentials,
  _signal?: AbortSignal,
): Promise<{ saved: number; error?: string }> {
  // Cooldown: avoid running too frequently
  const now = Date.now()
  if (now - lastConsolidationTime < CONSOLIDATION_COOLDOWN_MS) {
    return { saved: 0 }
  }
  lastConsolidationTime = now

  try {
    // Read today's log
    const logContent = await readDailyLog()
    if (!logContent || logContent.trim().length === 0) {
      return { saved: 0 }
    }

    // Read consolidation state
    const state = await readConsolidationState()
    const logFileName = getLogFileName()

    // Find new content
    const newContent = findNewLogContent(logContent, state, logFileName)
    if (!newContent) {
      return { saved: 0 }
    }

    console.log(`[Consolidation] Found new log content in ${logFileName}, tracking...`)

    // Update tracking state
    state[logFileName] = logContent.split('\n').length
    await writeConsolidationState(state)

    return { saved: 1 }
  } catch (err) {
    const errorMessage = (err as Error).message
    if ((err as Error).name === 'AbortError') {
      console.log('[Consolidation] Aborted')
    } else {
      console.error('[Consolidation] Failed:', errorMessage)
    }
    return { saved: 0, error: errorMessage }
  }
}
