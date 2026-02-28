/**
 * SyncService — Background Mirror Source Synchronization
 *
 * Periodically downloads full indexes from Mirror-strategy sources
 * and writes them into SQLite. Proxy sources are not touched here.
 *
 * Design:
 *   - Each Mirror source is synced independently
 *   - Batch INSERT (500 per transaction) to avoid long write-locks
 *   - ETag/Last-Modified for change detection (skip if unchanged)
 *   - On failure, old cached data is preserved
 *   - Emits 'store:sync-status-changed' IPC events for UI updates
 */

import type Database from 'better-sqlite3'
import type { DatabaseManager } from '../platform/store/types'
import type { RegistrySource, RegistryEntry } from '../../shared/store/store-types'
import { getAdapter } from './adapters'

const BATCH_SIZE = 500
const DEFAULT_MIRROR_TTL_MS = 3600000 // 1 hour

type SyncStatusListener = (event: {
  registryId: string
  status: 'idle' | 'syncing' | 'error'
  appCount: number
  error?: string
}) => void

export class SyncService {
  private db: Database.Database
  private dbManager: DatabaseManager
  private listener: SyncStatusListener | null = null
  private syncing = new Set<string>()

  constructor(dbManager: DatabaseManager) {
    this.dbManager = dbManager
    this.db = dbManager.getAppDatabase()
  }

  onSyncStatusChanged(listener: SyncStatusListener): void {
    this.listener = listener
  }

  private emit(registryId: string, status: 'idle' | 'syncing' | 'error', appCount: number, error?: string): void {
    // Only update last_synced_at on success ('idle') so failed sources are retried on next syncAll
    if (status === 'idle') {
      this.db.prepare(`
        INSERT INTO registry_sync_state (registry_id, strategy, status, last_synced_at, app_count, error_message)
        VALUES (?, 'mirror', ?, ?, ?, ?)
        ON CONFLICT(registry_id) DO UPDATE SET
          status = excluded.status,
          last_synced_at = excluded.last_synced_at,
          app_count = excluded.app_count,
          error_message = excluded.error_message
      `).run(registryId, status, Date.now(), appCount, error ?? null)
    } else {
      // syncing / error: update status but preserve last_synced_at
      this.db.prepare(`
        INSERT INTO registry_sync_state (registry_id, strategy, status, last_synced_at, app_count, error_message)
        VALUES (?, 'mirror', ?, 0, ?, ?)
        ON CONFLICT(registry_id) DO UPDATE SET
          status = excluded.status,
          app_count = excluded.app_count,
          error_message = excluded.error_message
      `).run(registryId, status, appCount, error ?? null)
    }

    this.listener?.({ registryId, status, appCount, error })
  }

  /**
   * Sync all enabled Mirror sources that are past their TTL.
   */
  async syncAll(registries: RegistrySource[], ttlMs = DEFAULT_MIRROR_TTL_MS): Promise<void> {
    const mirrorRegistries = registries.filter(r => {
      if (!r.enabled) return false
      const adapter = getAdapter(r)
      return adapter.strategy === 'mirror'
    })

    console.log('[SyncService] syncAll:start', {
      ttlMs,
      totalRegistries: registries.length,
      mirrorRegistries: mirrorRegistries.length,
    })

    const startedAt = performance.now()
    // Sync in parallel (each source is independent)
    await Promise.allSettled(
      mirrorRegistries.map(r => this.syncOne(r, ttlMs))
    )

    console.log('[SyncService] syncAll:done', {
      ttlMs,
      mirrorRegistries: mirrorRegistries.length,
      durationMs: Math.round(performance.now() - startedAt),
    })
  }

  /**
   * Sync a single Mirror source. Skips if within TTL and not forced.
   */
  async syncOne(registry: RegistrySource, ttlMs = DEFAULT_MIRROR_TTL_MS, force = false): Promise<void> {
    if (this.syncing.has(registry.id)) {
      console.log('[SyncService] syncOne:skip-already-syncing', { registryId: registry.id, ttlMs, force })
      return
    }

    // Check TTL
    if (!force) {
      const state = this.db.prepare(
        `SELECT last_synced_at FROM registry_sync_state WHERE registry_id = ?`
      ).get(registry.id) as { last_synced_at: number } | undefined

      if (state?.last_synced_at && (Date.now() - state.last_synced_at) < ttlMs) {
        console.log('[SyncService] syncOne:skip-fresh', {
          registryId: registry.id,
          ttlMs,
          ageMs: Date.now() - state.last_synced_at,
        })
        return // still fresh
      }
    }

    this.syncing.add(registry.id)
    this.emit(registry.id, 'syncing', 0)

    console.log('[SyncService] syncOne:start', {
      registryId: registry.id,
      registryName: registry.name,
      strategy: getAdapter(registry).strategy,
      ttlMs,
      force,
    })

    try {
      const adapter = getAdapter(registry)
      if (!adapter.fetchIndex) {
        throw new Error(`Adapter for ${registry.id} does not support fetchIndex`)
      }

      const t0 = performance.now()
      const index = await adapter.fetchIndex(registry)
      const entries = index.apps.filter(e => e.format === 'bundle')

      // Batch write into SQLite
      this.batchInsert(registry.id, entries)

      // Rebuild FTS index for this registry
      this.rebuildFts(registry.id)

      const dt = performance.now() - t0
      console.log(`[SyncService] Synced "${registry.name}": ${entries.length} entries in ${dt.toFixed(0)}ms`)
      console.log('[SyncService] syncOne:success', {
        registryId: registry.id,
        registryName: registry.name,
        entryCount: entries.length,
        durationMs: Math.round(dt),
      })

      this.emit(registry.id, 'idle', entries.length)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[SyncService] Sync failed for "${registry.name}": ${msg}`)
      console.error('[SyncService] syncOne:failed', {
        registryId: registry.id,
        registryName: registry.name,
        error: msg,
      })

      // Preserve old data, just update status
      const existing = this.db.prepare(
        `SELECT app_count FROM registry_sync_state WHERE registry_id = ?`
      ).get(registry.id) as { app_count: number } | undefined

      this.emit(registry.id, 'error', existing?.app_count ?? 0, msg)
    } finally {
      this.syncing.delete(registry.id)
      console.log('[SyncService] syncOne:finalize', { registryId: registry.id, inProgressCount: this.syncing.size })
    }
  }

  /**
   * Force refresh: clear cache for a registry and re-sync.
   */
  async forceSync(registry: RegistrySource): Promise<void> {
    this.clearRegistryItems(registry.id)
    await this.syncOne(registry, 0, true)
  }

  /**
   * Clear all cached data and re-sync all Mirror sources.
   */
  async forceSyncAll(registries: RegistrySource[]): Promise<void> {
    this.db.exec(`DELETE FROM registry_items`)
    this.db.exec(`DELETE FROM registry_items_fts`)
    this.db.exec(`DELETE FROM registry_query_cache`)
    this.db.exec(`DELETE FROM registry_spec_cache`)
    this.db.exec(`DELETE FROM registry_sync_state`)
    await this.syncAll(registries, 0)
  }

  /**
   * Clear Proxy source query cache for a specific registry.
   */
  clearProxyCache(registryId: string): void {
    this.db.prepare(`DELETE FROM registry_query_cache WHERE registry_id = ?`).run(registryId)
  }

  /**
   * Get sync state for all registries.
   */
  getSyncStates(): Array<{ registryId: string; status: string; appCount: number; lastSyncedAt: number | null }> {
    return this.db.prepare(
      `SELECT registry_id AS registryId, status, app_count AS appCount, last_synced_at AS lastSyncedAt FROM registry_sync_state`
    ).all() as Array<{
      registryId: string; status: string; appCount: number; lastSyncedAt: number | null
    }>
  }

  // ── Private ────────────────────────────────────────────────────────────

  private clearRegistryItems(registryId: string): void {
    this.db.prepare(`DELETE FROM registry_items WHERE registry_id = ?`).run(registryId)
  }

  private batchInsert(registryId: string, entries: RegistryEntry[]): void {
    const now = Date.now()

    // Delete existing entries for this registry first (in a batch)
    this.clearRegistryItems(registryId)

    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO registry_items (
        pk, slug, registry_id, name, description, author, tags,
        type, category, rank, version, icon, locale,
        format, path, download_url, size_bytes, checksum,
        requires_mcps, requires_skills,
        created_at, updated_at, i18n, meta, indexed_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?, ?
      )
    `)

    // Process in batches
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const batch = entries.slice(i, i + BATCH_SIZE)
      const runBatch = this.db.transaction(() => {
        for (const e of batch) {
          const rank = resolveRank(e)
          insert.run(
            `${registryId}:${e.slug}`,
            e.slug,
            registryId,
            e.name,
            e.description,
            e.author,
            JSON.stringify(e.tags ?? []),
            e.type,
            e.category ?? 'other',
            rank === Infinity ? null : rank,
            e.version,
            e.icon ?? null,
            e.locale ?? null,
            e.format,
            e.path,
            e.download_url ?? null,
            e.size_bytes ?? null,
            e.checksum ?? null,
            e.requires_mcps ? JSON.stringify(e.requires_mcps) : null,
            e.requires_skills ? JSON.stringify(e.requires_skills) : null,
            e.created_at ?? null,
            e.updated_at ?? null,
            e.i18n ? JSON.stringify(e.i18n) : null,
            e.meta ? JSON.stringify(e.meta) : null,
            now,
          )
        }
      })
      runBatch()
    }
  }

  private rebuildFts(registryId: string): void {
    // Delete FTS entries for this registry, then re-insert
    // FTS5 content-sync tables need manual management
    const rows = this.db.prepare(
      `SELECT rowid, name, description, author, tags FROM registry_items WHERE registry_id = ?`
    ).all(registryId) as Array<{ rowid: number; name: string; description: string; author: string; tags: string }>

    const deleteFts = this.db.prepare(
      `DELETE FROM registry_items_fts WHERE rowid IN (SELECT rowid FROM registry_items WHERE registry_id = ?)`
    )
    const insertFts = this.db.prepare(
      `INSERT INTO registry_items_fts (rowid, name, description, author, tags) VALUES (?, ?, ?, ?, ?)`
    )

    const rebuild = this.db.transaction(() => {
      // Try to delete existing FTS entries (may fail if none exist yet)
      try { deleteFts.run(registryId) } catch { /* ignore */ }
      for (const row of rows) {
        insertFts.run(row.rowid, row.name, row.description, row.author, row.tags)
      }
    })
    rebuild()
  }
}

function resolveRank(entry: RegistryEntry): number {
  const rank = entry.meta?.rank
  if (typeof rank === 'number' && Number.isFinite(rank) && rank >= 0 && Number.isInteger(rank)) {
    return rank
  }
  return Infinity
}
