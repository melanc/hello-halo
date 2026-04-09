/**
 * pipeline/store -- SQLite CRUD for pipeline tasks
 *
 * Tables:
 *   pipeline_tasks    - parent tasks (one per requirement)
 *   pipeline_subtasks - subtasks under each parent
 */

import type Database from 'better-sqlite3'

// ============================================================
// Types
// ============================================================

export type PipelineStage = 1 | 2 | 3 | 4 | 5

export type SubtaskStatus = 'pending' | 'in_progress' | 'done' | 'skipped'

export interface PipelineSubtask {
  id: string
  taskId: string
  index: number
  title: string
  description: string
  status: SubtaskStatus
  createdAt: number
  updatedAt: number
}

export interface PipelineTask {
  id: string
  spaceId: string
  title: string
  requirement: string          // raw requirement text from user
  stage: PipelineStage
  resumeHint: string           // shown next to Start Work button
  contextJson: string          // serialised Stage 3 context (affected projects, APIs, etc.)
  conversationJson: string     // Stage 3 dialogue history
  changesJson: string          // Stage 4 file changes list
  reviewJson: string           // Stage 5 review result
  gitBranch: string
  createdAt: number
  updatedAt: number
}

// ============================================================
// Row types (flat SQLite)
// ============================================================

interface TaskRow {
  id: string
  space_id: string
  title: string
  requirement: string
  stage: number
  resume_hint: string
  context_json: string
  conversation_json: string
  changes_json: string
  review_json: string
  git_branch: string
  created_at: number
  updated_at: number
}

interface SubtaskRow {
  id: string
  task_id: string
  idx: number
  title: string
  description: string
  status: string
  created_at: number
  updated_at: number
}

// ============================================================
// Migrations
// ============================================================

import type { Migration } from '../platform/store'

export const PIPELINE_NAMESPACE = 'pipeline'

export const PIPELINE_MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Create pipeline_tasks and pipeline_subtasks tables',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS pipeline_tasks (
          id                TEXT PRIMARY KEY,
          space_id          TEXT NOT NULL,
          title             TEXT NOT NULL DEFAULT '',
          requirement       TEXT NOT NULL DEFAULT '',
          stage             INTEGER NOT NULL DEFAULT 1,
          resume_hint       TEXT NOT NULL DEFAULT '',
          context_json      TEXT NOT NULL DEFAULT '{}',
          conversation_json TEXT NOT NULL DEFAULT '[]',
          changes_json      TEXT NOT NULL DEFAULT '[]',
          review_json       TEXT NOT NULL DEFAULT '{}',
          git_branch        TEXT NOT NULL DEFAULT '',
          created_at        INTEGER NOT NULL,
          updated_at        INTEGER NOT NULL
        )
      `)
      db.exec(`
        CREATE TABLE IF NOT EXISTS pipeline_subtasks (
          id          TEXT PRIMARY KEY,
          task_id     TEXT NOT NULL REFERENCES pipeline_tasks(id) ON DELETE CASCADE,
          idx         INTEGER NOT NULL,
          title       TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          status      TEXT NOT NULL DEFAULT 'pending',
          created_at  INTEGER NOT NULL,
          updated_at  INTEGER NOT NULL
        )
      `)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_pipeline_tasks_space ON pipeline_tasks(space_id)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_pipeline_subtasks_task ON pipeline_subtasks(task_id, idx)`)
    }
  }
]

// ============================================================
// Store class
// ============================================================

function rowToTask(row: TaskRow): PipelineTask {
  return {
    id: row.id,
    spaceId: row.space_id,
    title: row.title,
    requirement: row.requirement,
    stage: row.stage as PipelineStage,
    resumeHint: row.resume_hint,
    contextJson: row.context_json,
    conversationJson: row.conversation_json,
    changesJson: row.changes_json,
    reviewJson: row.review_json,
    gitBranch: row.git_branch,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToSubtask(row: SubtaskRow): PipelineSubtask {
  return {
    id: row.id,
    taskId: row.task_id,
    index: row.idx,
    title: row.title,
    description: row.description,
    status: row.status as SubtaskStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class PipelineStore {
  constructor(private db: Database.Database) {}

  // ── Tasks ─────────────────────────────────────────────────

  createTask(task: PipelineTask): void {
    this.db.prepare(`
      INSERT INTO pipeline_tasks
        (id, space_id, title, requirement, stage, resume_hint,
         context_json, conversation_json, changes_json, review_json,
         git_branch, created_at, updated_at)
      VALUES
        (@id, @space_id, @title, @requirement, @stage, @resume_hint,
         @context_json, @conversation_json, @changes_json, @review_json,
         @git_branch, @created_at, @updated_at)
    `).run({
      id: task.id,
      space_id: task.spaceId,
      title: task.title,
      requirement: task.requirement,
      stage: task.stage,
      resume_hint: task.resumeHint,
      context_json: task.contextJson,
      conversation_json: task.conversationJson,
      changes_json: task.changesJson,
      review_json: task.reviewJson,
      git_branch: task.gitBranch,
      created_at: task.createdAt,
      updated_at: task.updatedAt,
    })
  }

  getTask(id: string): PipelineTask | null {
    const row = this.db.prepare('SELECT * FROM pipeline_tasks WHERE id = ?').get(id) as TaskRow | undefined
    return row ? rowToTask(row) : null
  }

  listTasks(spaceId: string): PipelineTask[] {
    const rows = this.db.prepare(
      'SELECT * FROM pipeline_tasks WHERE space_id = ? ORDER BY created_at DESC'
    ).all(spaceId) as TaskRow[]
    return rows.map(rowToTask)
  }

  updateTask(id: string, updates: Partial<Omit<PipelineTask, 'id' | 'spaceId' | 'createdAt'>>): void {
    const now = Date.now()
    const fields: string[] = ['updated_at = @updated_at']
    const params: Record<string, unknown> = { id, updated_at: now }

    if (updates.title !== undefined)           { fields.push('title = @title');                       params.title = updates.title }
    if (updates.requirement !== undefined)     { fields.push('requirement = @requirement');           params.requirement = updates.requirement }
    if (updates.stage !== undefined)           { fields.push('stage = @stage');                       params.stage = updates.stage }
    if (updates.resumeHint !== undefined)      { fields.push('resume_hint = @resume_hint');           params.resume_hint = updates.resumeHint }
    if (updates.contextJson !== undefined)     { fields.push('context_json = @context_json');         params.context_json = updates.contextJson }
    if (updates.conversationJson !== undefined){ fields.push('conversation_json = @conversation_json'); params.conversation_json = updates.conversationJson }
    if (updates.changesJson !== undefined)     { fields.push('changes_json = @changes_json');         params.changes_json = updates.changesJson }
    if (updates.reviewJson !== undefined)      { fields.push('review_json = @review_json');           params.review_json = updates.reviewJson }
    if (updates.gitBranch !== undefined)       { fields.push('git_branch = @git_branch');             params.git_branch = updates.gitBranch }

    this.db.prepare(`UPDATE pipeline_tasks SET ${fields.join(', ')} WHERE id = @id`).run(params)
  }

  deleteTask(id: string): void {
    this.db.prepare('DELETE FROM pipeline_tasks WHERE id = ?').run(id)
  }

  // ── Subtasks ─────────────────────────────────────────────

  upsertSubtasks(taskId: string, subtasks: Array<{ id: string; title: string; description: string }>): void {
    const now = Date.now()
    const del = this.db.prepare('DELETE FROM pipeline_subtasks WHERE task_id = ?')
    const ins = this.db.prepare(`
      INSERT INTO pipeline_subtasks (id, task_id, idx, title, description, status, created_at, updated_at)
      VALUES (@id, @task_id, @idx, @title, @description, 'pending', @created_at, @updated_at)
    `)
    const tx = this.db.transaction(() => {
      del.run(taskId)
      subtasks.forEach((s, i) => ins.run({
        id: s.id, task_id: taskId, idx: i,
        title: s.title, description: s.description,
        created_at: now, updated_at: now,
      }))
    })
    tx()
  }

  listSubtasks(taskId: string): PipelineSubtask[] {
    const rows = this.db.prepare(
      'SELECT * FROM pipeline_subtasks WHERE task_id = ? ORDER BY idx ASC'
    ).all(taskId) as SubtaskRow[]
    return rows.map(rowToSubtask)
  }

  updateSubtaskStatus(id: string, status: SubtaskStatus): void {
    this.db.prepare(
      'UPDATE pipeline_subtasks SET status = ?, updated_at = ? WHERE id = ?'
    ).run(status, Date.now(), id)
  }
}
