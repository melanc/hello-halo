/**
 * Workspace tasks — local persistence until server-side storage exists.
 * One task = one space + one main conversation + requirement document context.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { api } from '../api'
import type { WorkspaceTask, PipelineStage, PipelineSubtask } from '../types'
import { appendConversationExcerptToBreakdownMarkdown } from '../lib/parse-implementation-breakdown'
import { useChatStore } from './chat.store'

const STORAGE_KEY = 'devx-workspace-tasks-v1'

function newTaskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

interface TaskState {
  tasks: WorkspaceTask[]
  /** Task receiving artifact touch attribution (session-only, not persisted) */
  activeTaskId: string | null
  /** Task that needs requirement document editing (session-only) */
  pendingRequirementTaskId: string | null

  setActiveTask: (id: string | null) => void
  clearActiveTask: () => void
  setPendingRequirementTask: (id: string | null) => void
  clearPendingRequirementTask: () => void

  addTask: (input: {
    name: string
    spaceId: string
    knowledgeBaseSpaceId?: string
    requirementDocName: string
    requirementDocContent: string
    requirementDescription: string
    projectDirs: string[]
    branchName: string
  }) => Promise<WorkspaceTask | null>

  removeTask: (id: string) => void
  updateTaskRequirementDoc: (
    taskId: string,
    requirementDocName: string,
    requirementDocContent: string,
    requirementDescription: string
  ) => void

  /** Rename a workspace task */
  updateTaskName: (taskId: string, name: string) => void

  /**
   * Move task to another space: new conversation in target space, pipeline reset.
   * Returns false if conversation could not be created.
   */
  moveTaskToSpace: (taskId: string, newSpaceId: string) => Promise<boolean>

  /** Link or clear optional knowledge-base space (Markdown docs) for pipeline context */
  updateTaskKnowledgeBaseSpaceId: (taskId: string, knowledgeBaseSpaceId: string | null) => void

  /** Record first-level project dir from artifact relativePath for the active task */
  recordArtifactTouch: (spaceId: string, relativePath: string) => void

  /** Add a top-level project folder to the task (from file tree context menu) */
  addProjectDirToTask: (taskId: string, topLevelDir: string) => void

  /** Remove a top-level project folder from the task (from file tree context menu) */
  removeProjectDirFromTask: (taskId: string, topLevelDir: string) => void

  markRequirementIdentifyUsed: (taskId: string) => void
  markRequirementBreakdownUsed: (taskId: string) => void
  /** Save AI-identified structured requirements into requirementDescription and mark identify as used. */
  saveIdentifiedRequirements: (taskId: string, description: string) => void
  /** Persist breakdown reply text when a breakdown run completes successfully */
  completeRequirementBreakdown: (taskId: string, assistantPlanMarkdown: string) => void

  /** Replace first occurrence of find in saved breakdown plan (user-edited excerpt sync). */
  replaceBreakdownPlanExcerpt: (taskId: string, find: string, replace: string) => boolean

  /** Append a Markdown block to the saved breakdown plan. */
  appendBreakdownPlanSection: (taskId: string, sectionMarkdown: string) => void

  /** Append chat selection into one shared "conversation excerpts" section (no new top-level item each time). */
  appendConversationExcerptToBreakdownPlan: (taskId: string, excerpt: string) => void

  /** Update pipeline stage, subtasks, resume hint, and/or dev plan for inline pipeline panel */
  updateTaskPipelineState: (taskId: string, updates: {
    stage?: PipelineStage
    pipelineSubtasks?: PipelineSubtask[]
    pipelineResumeHint?: string
    pipelineDevPlan?: string
    pipelineProjectChanges?: string
    pipelineDepCheckCmd?: string
    pipelineBuildCheckCmd?: string
  }) => void

  /** Persist identified requirement key points */
  updateTaskRequirementKeyPoints: (taskId: string, points: string[]) => void
  /** Persist full AI-generated requirement analysis text */
  updateTaskRequirementAnalysis: (taskId: string, analysis: string) => void

  /** Update development branch name (shared across involved projects) */
  updateTaskBranchName: (taskId: string, branchName: string) => void

  /** Append one line to the coding-phase activity log (capped) */
  appendPipelineCodingLog: (taskId: string, line: string) => void
}

export const useTaskStore = create<TaskState>()(
  persist(
    (set, get) => ({
      tasks: [],
      activeTaskId: null,
      pendingRequirementTaskId: null,

      setActiveTask: (id) => set({ activeTaskId: id }),
      clearActiveTask: () => set({ activeTaskId: null }),
      setPendingRequirementTask: (id) => set({ pendingRequirementTaskId: id }),
      clearPendingRequirementTask: () => set({ pendingRequirementTaskId: null }),

      addTask: async (input) => {
        const spaceId = input.spaceId.trim()
        if (!spaceId) return null

        const requirementDocName = (input as { requirementDocName?: string }).requirementDocName?.trim() || ''
        const requirementDocContent =
          (input as { requirementDocContent?: string }).requirementDocContent?.trim() || ''
        const requirementDescription =
          (input as { requirementDescription?: string }).requirementDescription?.trim() || ''
        const hasDoc = Boolean(requirementDocName && requirementDocContent)
        if (!hasDoc && !requirementDescription) return null

        const branchName = input.branchName.trim()
        const projectDirs = input.projectDirs.map((d) => d.trim()).filter(Boolean)
        const kbRaw = (input as { knowledgeBaseSpaceId?: string }).knowledgeBaseSpaceId?.trim()
        const knowledgeBaseSpaceId = kbRaw || undefined

        const conv = await useChatStore.getState().createConversation(spaceId, input.name)
        if (!conv) return null

        const now = Date.now()
        const task: WorkspaceTask = {
          id: newTaskId(),
          name: input.name.trim(),
          spaceId,
          ...(knowledgeBaseSpaceId ? { knowledgeBaseSpaceId } : {}),
          requirementDocName,
          requirementDocContent,
          requirementDescription,
          projectDirs,
          branchName,
          conversationId: conv.id,
          createdAt: now,
          updatedAt: now,
          touchedProjectDirs: [],
        }

        set((s) => ({ tasks: [task, ...s.tasks] }))
        return task
      },

      removeTask: (id) => {
        set((s) => ({
          tasks: s.tasks.filter((t) => t.id !== id),
          activeTaskId: s.activeTaskId === id ? null : s.activeTaskId,
          pendingRequirementTaskId:
            s.pendingRequirementTaskId === id ? null : s.pendingRequirementTaskId,
        }))
      },
      updateTaskRequirementDoc: (taskId, requirementDocName, requirementDocContent, requirementDescription) => {
        const docName = requirementDocName.trim()
        const docContent = requirementDocContent.trim()
        const desc = requirementDescription.trim()
        const hasDoc = Boolean(docName && docContent)
        if (!hasDoc && !desc) return
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id !== taskId
              ? t
              : {
                  ...t,
                  requirementDocName: docName,
                  requirementDocContent: docContent,
                  requirementDescription: desc,
                  requirementIdentifyUsed: false,
                  requirementBreakdownUsed: false,
                  breakdownPlanMarkdown: undefined,
                  updatedAt: Date.now(),
                }
          ),
          pendingRequirementTaskId:
            s.pendingRequirementTaskId === taskId ? null : s.pendingRequirementTaskId,
        }))
      },

      updateTaskName: (taskId, name) => {
        const n = name.trim()
        if (!n) return
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId ? { ...t, name: n, updatedAt: Date.now() } : t
          ),
        }))
      },

      moveTaskToSpace: async (taskId, newSpaceId) => {
        const sid = newSpaceId.trim()
        const task = get().tasks.find((t) => t.id === taskId)
        if (!task || task.spaceId === sid) return true
        const conv = await useChatStore.getState().createConversation(sid, task.name)
        if (!conv) return false
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id !== taskId
              ? t
              : {
                  ...t,
                  spaceId: sid,
                  conversationId: conv.id,
                  updatedAt: Date.now(),
                  knowledgeBaseSpaceId: t.knowledgeBaseSpaceId,
                  requirementIdentifyUsed: false,
                  requirementBreakdownUsed: false,
                  breakdownPlanMarkdown: undefined,
                  pipelineStage: undefined,
                  pipelineSubtasks: undefined,
                  pipelineResumeHint: undefined,
                  pipelineDevPlan: undefined,
                  requirementKeyPoints: undefined,
                  requirementAnalysis: undefined,
                  pipelineCodingLogLines: undefined,
                  touchedProjectDirs: [],
                  branchName: '',
                  projectDirs: [],
                }
          ),
        }))
        return true
      },

      updateTaskKnowledgeBaseSpaceId: (taskId, knowledgeBaseSpaceId) => {
        const kb = knowledgeBaseSpaceId?.trim()
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  ...(kb ? { knowledgeBaseSpaceId: kb } : { knowledgeBaseSpaceId: undefined }),
                  updatedAt: Date.now(),
                }
              : t
          ),
        }))
      },

      recordArtifactTouch: (spaceId, relativePath) => {
        const { activeTaskId, tasks } = get()
        if (!activeTaskId || !relativePath) return
        const task = tasks.find((t) => t.id === activeTaskId)
        if (!task || task.spaceId !== spaceId) return

        const segment = relativePath.split(/[/\\]/).filter(Boolean)[0]
        if (!segment) return

        set((s) => ({
          tasks: s.tasks.map((t) => {
            if (t.id !== activeTaskId) return t
            const prev = t.touchedProjectDirs ?? []
            if (prev.includes(segment)) return t
            return {
              ...t,
              touchedProjectDirs: [...prev, segment],
              updatedAt: Date.now(),
            }
          }),
        }))
      },

      addProjectDirToTask: (taskId, topLevelDir) => {
        const name = topLevelDir.trim()
        if (!name) return
        set((s) => ({
          tasks: s.tasks.map((t) => {
            if (t.id !== taskId) return t
            if (t.projectDirs.includes(name)) return t
            return {
              ...t,
              projectDirs: [...t.projectDirs, name],
              updatedAt: Date.now(),
            }
          }),
        }))
      },

      removeProjectDirFromTask: (taskId, topLevelDir) => {
        const name = topLevelDir.trim()
        if (!name) return
        set((s) => ({
          tasks: s.tasks.map((t) => {
            if (t.id !== taskId) return t
            if (!t.projectDirs.includes(name)) return t
            const touched = t.touchedProjectDirs ?? []
            return {
              ...t,
              projectDirs: t.projectDirs.filter((d) => d !== name),
              touchedProjectDirs: touched.filter((d) => d !== name),
              updatedAt: Date.now(),
            }
          }),
        }))
      },

      markRequirementIdentifyUsed: (taskId) => {
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id !== taskId ? t : { ...t, requirementIdentifyUsed: true, updatedAt: Date.now() }
          ),
        }))
      },

      saveIdentifiedRequirements: (taskId, description) => {
        const text = description.trim()
        if (!text) return
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id !== taskId
              ? t
              : { ...t, requirementDescription: text, requirementIdentifyUsed: true, updatedAt: Date.now() }
          ),
        }))
      },

      markRequirementBreakdownUsed: (taskId) => {
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id !== taskId ? t : { ...t, requirementBreakdownUsed: true, updatedAt: Date.now() }
          ),
        }))
      },

      completeRequirementBreakdown: (taskId, assistantPlanMarkdown) => {
        const raw = assistantPlanMarkdown.trim()
        const capped = raw.length > 120_000 ? `${raw.slice(0, 120_000)}\n\n…` : raw
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id !== taskId
              ? t
              : {
                  ...t,
                  requirementBreakdownUsed: true,
                  breakdownPlanMarkdown: capped || undefined,
                  updatedAt: Date.now(),
                }
          ),
        }))
      },

      replaceBreakdownPlanExcerpt: (taskId, find, replace) => {
        const needle = find.trim()
        if (!needle) return false
        let ok = false
        set((s) => ({
          tasks: s.tasks.map((t) => {
            if (t.id !== taskId || !t.breakdownPlanMarkdown) return t
            const hay = t.breakdownPlanMarkdown
            const idx = hay.indexOf(needle)
            if (idx === -1) return t
            ok = true
            let next = hay.slice(0, idx) + replace + hay.slice(idx + needle.length)
            if (replace === '') {
              next = next.replace(/\n{3,}/g, '\n\n')
              const trimmed = next.trim()
              return {
                ...t,
                breakdownPlanMarkdown: trimmed.length > 0 ? trimmed : undefined,
                updatedAt: Date.now(),
              }
            }
            return { ...t, breakdownPlanMarkdown: next, updatedAt: Date.now() }
          }),
        }))
        return ok
      },

      appendBreakdownPlanSection: (taskId, sectionMarkdown) => {
        const add = sectionMarkdown.trim()
        if (!add) return
        set((s) => ({
          tasks: s.tasks.map((t) => {
            if (t.id !== taskId) return t
            const cur = (t.breakdownPlanMarkdown ?? '').trim()
            const next = cur ? `${cur}\n\n${add}` : add
            return { ...t, breakdownPlanMarkdown: next, updatedAt: Date.now() }
          }),
        }))
      },

      appendConversationExcerptToBreakdownPlan: (taskId, excerpt) => {
        const text = excerpt.trim()
        if (!text) return
        set((s) => ({
          tasks: s.tasks.map((t) => {
            if (t.id !== taskId) return t
            const next = appendConversationExcerptToBreakdownMarkdown(t.breakdownPlanMarkdown, text).trim()
            return { ...t, breakdownPlanMarkdown: next.length > 0 ? next : undefined, updatedAt: Date.now() }
          }),
        }))
      },

      updateTaskPipelineState: (taskId, updates) => {
        set((s) => ({
          tasks: s.tasks.map((t) => {
            if (t.id !== taskId) return t
            return {
              ...t,
              ...(updates.stage !== undefined && { pipelineStage: updates.stage }),
              ...(updates.pipelineSubtasks !== undefined && { pipelineSubtasks: updates.pipelineSubtasks }),
              ...(updates.pipelineDevPlan !== undefined && { pipelineDevPlan: updates.pipelineDevPlan }),
              ...(updates.pipelineProjectChanges !== undefined && { pipelineProjectChanges: updates.pipelineProjectChanges }),
              ...(updates.pipelineResumeHint !== undefined && { pipelineResumeHint: updates.pipelineResumeHint }),
              ...(updates.pipelineDepCheckCmd !== undefined && { pipelineDepCheckCmd: updates.pipelineDepCheckCmd }),
              ...(updates.pipelineBuildCheckCmd !== undefined && { pipelineBuildCheckCmd: updates.pipelineBuildCheckCmd }),
              updatedAt: Date.now(),
            }
          }),
        }))
      },

      updateTaskRequirementKeyPoints: (taskId, points) => {
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId ? { ...t, requirementKeyPoints: points, updatedAt: Date.now() } : t
          ),
        }))
      },

      updateTaskRequirementAnalysis: (taskId, analysis) => {
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId ? { ...t, requirementAnalysis: analysis, updatedAt: Date.now() } : t
          ),
        }))
      },

      updateTaskBranchName: (taskId, branchName) => {
        const name = branchName.trim()
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId ? { ...t, branchName: name, updatedAt: Date.now() } : t
          ),
        }))
      },

      appendPipelineCodingLog: (taskId, line) => {
        const text = line.trim()
        if (!text) return
        const maxLines = 80
        set((s) => ({
          tasks: s.tasks.map((t) => {
            if (t.id !== taskId) return t
            const prev = t.pipelineCodingLogLines ?? []
            const next = [...prev, text].slice(-maxLines)
            return { ...t, pipelineCodingLogLines: next, updatedAt: Date.now() }
          }),
        }))
      },
    }),
    {
      name: STORAGE_KEY,
      partialize: (state) => ({ tasks: state.tasks }),
    }
  )
)

/** Subscribe once at app root — attributes artifact changes to the active task */
export function initTaskStoreListeners(): () => void {
  return api.onArtifactChanged((event) => {
    if (!event.relativePath) return
    useTaskStore.getState().recordArtifactTouch(event.spaceId, event.relativePath)
  })
}
