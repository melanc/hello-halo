/**
 * pipeline -- service singleton
 *
 * Initialised during extended bootstrap after the SQLite db is ready.
 * Runs migrations and exposes the PipelineStore instance.
 */

import type { DatabaseManager } from '../platform/store'
import { PipelineStore, PIPELINE_NAMESPACE, PIPELINE_MIGRATIONS } from './store'

let _store: PipelineStore | null = null

export function initPipeline(db: DatabaseManager): PipelineStore {
  const appDb = db.getAppDatabase()
  db.runMigrations(appDb, PIPELINE_NAMESPACE, PIPELINE_MIGRATIONS)
  _store = new PipelineStore(appDb)
  console.log('[Pipeline] Store initialized')
  return _store
}

export function getPipelineStore(): PipelineStore | null {
  return _store
}

export function shutdownPipeline(): void {
  _store = null
}

export type { PipelineTask, PipelineSubtask, PipelineStage, SubtaskStatus } from './store'
