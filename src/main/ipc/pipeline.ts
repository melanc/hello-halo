/**
 * Pipeline IPC Handlers
 *
 * Channels:
 *   pipeline:list-tasks        List tasks for a space
 *   pipeline:get-task          Get a single task with its subtasks
 *   pipeline:create-task       Create a new task
 *   pipeline:update-task       Update task fields (stage, resumeHint, contextJson, etc.)
 *   pipeline:delete-task       Delete a task (and its subtasks via CASCADE)
 *   pipeline:upsert-subtasks   Replace all subtasks for a task
 *   pipeline:update-subtask-status  Update a single subtask status
 */

import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getPipelineStore } from '../pipeline'
import type { PipelineStage, SubtaskStatus } from '../pipeline'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireStore() {
  const store = getPipelineStore()
  if (!store) {
    return { success: false as const, error: 'Pipeline store is not yet initialized. Please try again shortly.' }
  }
  return { success: true as const, store }
}

// ---------------------------------------------------------------------------
// Handler registration
// ---------------------------------------------------------------------------

export function registerPipelineHandlers(): void {

  // List all tasks for a space (sorted newest first)
  ipcMain.handle('pipeline:list-tasks', (_event, spaceId: string) => {
    const r = requireStore()
    if (!r.success) return r
    try {
      const tasks = r.store.listTasks(spaceId)
      // Attach subtasks to each task
      const result = tasks.map(task => ({
        ...task,
        subtasks: r.store.listSubtasks(task.id),
      }))
      return { success: true, data: result }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // Get a single task with subtasks
  ipcMain.handle('pipeline:get-task', (_event, taskId: string) => {
    const r = requireStore()
    if (!r.success) return r
    try {
      const task = r.store.getTask(taskId)
      if (!task) return { success: false, error: 'Task not found' }
      const subtasks = r.store.listSubtasks(taskId)
      return { success: true, data: { ...task, subtasks } }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // Create a new task
  ipcMain.handle('pipeline:create-task', (_event, input: { spaceId: string; title: string; requirement: string }) => {
    const r = requireStore()
    if (!r.success) return r
    try {
      const now = Date.now()
      const task = {
        id: randomUUID(),
        spaceId: input.spaceId,
        title: input.title || input.requirement.slice(0, 60),
        requirement: input.requirement,
        stage: 1 as PipelineStage,
        resumeHint: '',
        contextJson: '{}',
        conversationJson: '[]',
        changesJson: '[]',
        reviewJson: '{}',
        gitBranch: '',
        createdAt: now,
        updatedAt: now,
      }
      r.store.createTask(task)
      return { success: true, data: { ...task, subtasks: [] } }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // Update task fields
  ipcMain.handle('pipeline:update-task', (_event, input: {
    taskId: string
    updates: {
      title?: string
      requirement?: string
      stage?: PipelineStage
      resumeHint?: string
      contextJson?: string
      conversationJson?: string
      changesJson?: string
      reviewJson?: string
      gitBranch?: string
    }
  }) => {
    const r = requireStore()
    if (!r.success) return r
    try {
      r.store.updateTask(input.taskId, input.updates)
      const task = r.store.getTask(input.taskId)
      if (!task) return { success: false, error: 'Task not found after update' }
      const subtasks = r.store.listSubtasks(input.taskId)
      return { success: true, data: { ...task, subtasks } }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // Delete a task
  ipcMain.handle('pipeline:delete-task', (_event, taskId: string) => {
    const r = requireStore()
    if (!r.success) return r
    try {
      r.store.deleteTask(taskId)
      return { success: true, data: null }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // Replace all subtasks for a task (called after Stage 2 breakdown)
  ipcMain.handle('pipeline:upsert-subtasks', (_event, input: {
    taskId: string
    subtasks: Array<{ title: string; description: string }>
  }) => {
    const r = requireStore()
    if (!r.success) return r
    try {
      const subtasks = input.subtasks.map(s => ({
        id: randomUUID(),
        title: s.title,
        description: s.description,
      }))
      r.store.upsertSubtasks(input.taskId, subtasks)
      return { success: true, data: r.store.listSubtasks(input.taskId) }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // Update a single subtask's status
  ipcMain.handle('pipeline:update-subtask-status', (_event, input: {
    subtaskId: string
    status: SubtaskStatus
  }) => {
    const r = requireStore()
    if (!r.success) return r
    try {
      r.store.updateSubtaskStatus(input.subtaskId, input.status)
      return { success: true, data: null }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  console.log('[Pipeline] IPC handlers registered')
}
