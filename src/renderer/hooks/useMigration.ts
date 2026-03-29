/**
 * useMigration — generic scan-then-migrate workflow hook.
 *
 * Encapsulates the symmetric state machine shared by Skills migration and
 * MCP migration in CLIConfigSection:
 *
 *   idle → scanning → scanned → migrating → done
 *                ↘ error       ↗
 *
 * Eliminates 10 useState calls (5 per migration type) from the component.
 */

import { useState, useCallback } from 'react'
import type { CliMigrateResult } from '../types'

export type MigrationPhase = 'idle' | 'scanning' | 'scanned' | 'migrating' | 'done' | 'error'

export interface UseMigrationOptions<TEntry, TAction extends string> {
  /** IPC call that returns the scan data. Must return the items array. */
  scan: () => Promise<{ success: boolean; data?: unknown; error?: string }>
  /** Extract items from the scan response data. */
  extractItems: (data: unknown) => TEntry[]
  /** Compute default action for each scanned item. */
  defaultAction: (item: TEntry) => TAction
  /** Get the unique key for an item. */
  getKey: (item: TEntry) => string
  /** IPC call that performs the migration. */
  migrate: (actions: Array<{ name: string; action: TAction }>) => Promise<{ success: boolean; data?: unknown; error?: string }>
  /** Extract results from the migrate response data. */
  extractResults: (data: unknown) => CliMigrateResult[]
  /** Fallback message when scan IPC returns no error string (should be translated by caller) */
  scanFailedMessage?: string
  /** Fallback message when migrate IPC returns no error string (should be translated by caller) */
  migrateFailedMessage?: string
}

export interface UseMigrationReturn<TEntry, TAction extends string> {
  phase: MigrationPhase
  items: TEntry[]
  actions: Record<string, TAction>
  results: CliMigrateResult[] | null
  error: string | null
  setAction: (key: string, action: TAction) => void
  doScan: () => Promise<void>
  doMigrate: () => Promise<void>
  reset: () => void
}

export function useMigration<TEntry, TAction extends string>(
  opts: UseMigrationOptions<TEntry, TAction>
): UseMigrationReturn<TEntry, TAction> {
  const [phase, setPhase] = useState<MigrationPhase>('idle')
  const [items, setItems] = useState<TEntry[]>([])
  const [actions, setActions] = useState<Record<string, TAction>>({})
  const [results, setResults] = useState<CliMigrateResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const setAction = useCallback((key: string, action: TAction) => {
    setActions(prev => ({ ...prev, [key]: action }))
  }, [])

  const doScan = useCallback(async () => {
    setPhase('scanning')
    setError(null)
    setResults(null)
    try {
      const res = await opts.scan()
      if (res.success && res.data) {
        const list = opts.extractItems(res.data)
        setItems(list)
        const defaults: Record<string, TAction> = {}
        for (const item of list) {
          defaults[opts.getKey(item)] = opts.defaultAction(item)
        }
        setActions(defaults)
        setPhase('scanned')
      } else {
        setError(res.error ?? opts.scanFailedMessage ?? 'Scan failed')
        setPhase('error')
      }
    } catch (e: unknown) {
      setError((e as Error).message)
      setPhase('error')
    }
  }, [opts])

  const doMigrate = useCallback(async () => {
    setPhase('migrating')
    setError(null)
    try {
      const payload = items.map(item => ({
        name: opts.getKey(item),
        action: actions[opts.getKey(item)] ?? opts.defaultAction(item),
      }))
      const res = await opts.migrate(payload)
      if (res.success && res.data) {
        setResults(opts.extractResults(res.data))
        setPhase('done')
      } else {
        setError(res.error ?? opts.migrateFailedMessage ?? 'Migration failed')
        setPhase('error')
      }
    } catch (e: unknown) {
      setError((e as Error).message)
      setPhase('error')
    }
  }, [items, actions, opts])

  const reset = useCallback(() => {
    setPhase('idle')
    setItems([])
    setActions({})
    setResults(null)
    setError(null)
  }, [])

  return { phase, items, actions, results, error, setAction, doScan, doMigrate, reset }
}
