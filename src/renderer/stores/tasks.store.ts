/**
 * Tasks Store - Pipeline state management
 *
 * Manages the list of pipeline tasks for the current space,
 * selected task, and CRUD operations.
 */

import { create } from 'zustand'
import { api } from '../api'

// ============================================================
// Types (mirror backend domain types)
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
  requirement: string
  stage: PipelineStage
  resumeHint: string
  contextJson: string
  conversationJson: string
  changesJson: string
  reviewJson: string
  gitBranch: string
  createdAt: number
  updatedAt: number
  subtasks: PipelineSubtask[]
}

// ============================================================
// Store
// ============================================================

interface TasksState {
  tasks: PipelineTask[]
  selectedTaskId: string | null
  isLoading: boolean
  isSaving: boolean
  error: string | null

  // Actions
  loadTasks: (spaceId: string) => Promise<void>
  selectTask: (taskId: string | null) => void
  createTask: (spaceId: string, requirement: string) => Promise<PipelineTask | null>
  updateTask: (taskId: string, updates: Partial<Omit<PipelineTask, 'id' | 'spaceId' | 'subtasks' | 'createdAt'>>) => Promise<void>
  deleteTask: (taskId: string) => Promise<void>
  upsertSubtasks: (taskId: string, subtasks: Array<{ title: string; description: string }>) => Promise<void>
  updateSubtaskStatus: (taskId: string, subtaskId: string, status: SubtaskStatus) => Promise<void>

  // Computed helpers
  getSelectedTask: () => PipelineTask | null
}

export const useTasksStore = create<TasksState>((set, get) => ({
  tasks: [],
  selectedTaskId: null,
  isLoading: false,
  isSaving: false,
  error: null,

  loadTasks: async (spaceId: string) => {
    set({ isLoading: true, error: null })
    try {
      const res = await api.pipelineListTasks(spaceId)
      if (res.success && res.data) {
        set({ tasks: res.data as PipelineTask[], isLoading: false })
      } else {
        set({ error: res.error || 'Failed to load tasks', isLoading: false })
      }
    } catch (e) {
      set({ error: String(e), isLoading: false })
    }
  },

  selectTask: (taskId: string | null) => {
    set({ selectedTaskId: taskId })
  },

  createTask: async (spaceId: string, requirement: string) => {
    set({ isSaving: true })
    try {
      const res = await api.pipelineCreateTask({ spaceId, title: '', requirement })
      if (res.success && res.data) {
        const task = res.data as PipelineTask
        set(state => ({
          tasks: [task, ...state.tasks],
          selectedTaskId: task.id,
          isSaving: false,
        }))
        return task
      }
      set({ isSaving: false })
      return null
    } catch (e) {
      set({ isSaving: false })
      return null
    }
  },

  updateTask: async (taskId: string, updates: Partial<Omit<PipelineTask, 'id' | 'spaceId' | 'subtasks' | 'createdAt'>>) => {
    set({ isSaving: true })
    try {
      const res = await api.pipelineUpdateTask({ taskId, updates: updates as Record<string, unknown> })
      if (res.success && res.data) {
        const updated = res.data as PipelineTask
        set(state => ({
          tasks: state.tasks.map(t => t.id === taskId ? updated : t),
          isSaving: false,
        }))
      } else {
        set({ isSaving: false })
      }
    } catch (e) {
      set({ isSaving: false })
    }
  },

  deleteTask: async (taskId: string) => {
    set({ isSaving: true })
    try {
      await api.pipelineDeleteTask(taskId)
      set(state => ({
        tasks: state.tasks.filter(t => t.id !== taskId),
        selectedTaskId: state.selectedTaskId === taskId ? null : state.selectedTaskId,
        isSaving: false,
      }))
    } catch (e) {
      set({ isSaving: false })
    }
  },

  upsertSubtasks: async (taskId: string, subtasks: Array<{ title: string; description: string }>) => {
    set({ isSaving: true })
    try {
      const res = await api.pipelineUpsertSubtasks({ taskId, subtasks })
      if (res.success && res.data) {
        const updated = res.data as PipelineSubtask[]
        set(state => ({
          tasks: state.tasks.map(t =>
            t.id === taskId ? { ...t, subtasks: updated } : t
          ),
          isSaving: false,
        }))
      } else {
        set({ isSaving: false })
      }
    } catch (e) {
      set({ isSaving: false })
    }
  },

  updateSubtaskStatus: async (taskId: string, subtaskId: string, status: SubtaskStatus) => {
    // Optimistic update
    set(state => ({
      tasks: state.tasks.map(t =>
        t.id === taskId
          ? { ...t, subtasks: t.subtasks.map(s => s.id === subtaskId ? { ...s, status } : s) }
          : t
      )
    }))
    try {
      await api.pipelineUpdateSubtaskStatus({ subtaskId, status })
    } catch (_e) {
      // revert on failure would require snapshot; skip for now
    }
  },

  getSelectedTask: () => {
    const { tasks, selectedTaskId } = get()
    return tasks.find(t => t.id === selectedTaskId) ?? null
  },
}))
