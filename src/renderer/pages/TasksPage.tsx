/**
 * Tasks Page - Requirements & Pipeline Workflow
 *
 * Layout: Header + split pane (task list sidebar | task detail)
 *
 * Pipeline stages per task:
 *   1 - Requirements input
 *   2 - Task breakdown (AI generates subtasks)
 *   3 - Intent confirmation (AI asks follow-up questions)
 *   4 - Code implementation (AI edits files)
 *   5 - Review & validation
 */

import { useEffect, useState, useRef, useCallback } from 'react'
import { useAppStore } from '../stores/app.store'
import { useSpaceStore } from '../stores/space.store'
import { useTasksStore, type PipelineTask, type PipelineStage } from '../stores/tasks.store'
import { Header } from '../components/layout/Header'
import { Plus, Trash2, ChevronLeft, CheckCircle2, Circle, Loader2, ClipboardList } from 'lucide-react'

// ============================================================
// Stage metadata
// ============================================================

const STAGE_LABELS: Record<PipelineStage, string> = {
  1: '需求理解',
  2: '任务拆解',
  3: '意图确认',
  4: '编码实现',
  5: '验证收尾',
}

const STAGE_BADGE: Record<PipelineStage, string> = {
  1: 'bg-muted text-muted-foreground',
  2: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  3: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  4: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  5: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
}

// ============================================================
// New Task Dialog
// ============================================================

function NewTaskDialog({ spaceId, onClose }: { spaceId: string; onClose: () => void }) {
  const [requirement, setRequirement] = useState('')
  const { createTask, isSaving } = useTasksStore()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const handleCreate = useCallback(async () => {
    if (!requirement.trim()) return
    const task = await createTask(spaceId, requirement.trim())
    if (task) onClose()
  }, [requirement, spaceId, createTask, onClose])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleCreate()
    }
    if (e.key === 'Escape') onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-background border border-border rounded-xl shadow-xl w-full max-w-lg mx-4 p-5">
        <h2 className="text-base font-semibold mb-3">描述你的需求</h2>
        <textarea
          ref={textareaRef}
          className="w-full h-32 text-sm bg-secondary/50 border border-border rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
          placeholder="粘贴需求描述、产品文档片段、或一句话说明要做什么..."
          value={requirement}
          onChange={e => setRequirement(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <p className="text-xs text-muted-foreground mt-1.5 mb-4">⌘ + Enter 创建</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleCreate}
            disabled={!requirement.trim() || isSaving}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            创建并开始分析
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// Task List Item
// ============================================================

function TaskListItem({ task, isSelected, onClick }: {
  task: PipelineTask
  isSelected: boolean
  onClick: () => void
}) {
  const doneCount = task.subtasks.filter(s => s.status === 'done').length
  const totalCount = task.subtasks.length

  return (
    <button
      onClick={onClick}
      className={`
        w-full text-left px-3 py-2.5 rounded-lg transition-colors group
        ${isSelected
          ? 'bg-primary/10 border border-primary/20'
          : 'hover:bg-secondary border border-transparent'
        }
      `}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <p className="text-sm font-medium leading-snug line-clamp-2 flex-1">
          {task.title || task.requirement.slice(0, 60)}
        </p>
        <span className={`flex-shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${STAGE_BADGE[task.stage]}`}>
          {STAGE_LABELS[task.stage]}
        </span>
      </div>
      {task.resumeHint && (
        <p className="text-xs text-muted-foreground truncate">{task.resumeHint}</p>
      )}
      {totalCount > 0 && (
        <div className="flex items-center gap-1.5 mt-1.5">
          <div className="flex-1 h-1 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-primary/50 rounded-full transition-all"
              style={{ width: `${(doneCount / totalCount) * 100}%` }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground">{doneCount}/{totalCount}</span>
        </div>
      )}
    </button>
  )
}

// ============================================================
// Pipeline Stage Indicator
// ============================================================

function PipelineStageBar({ currentStage }: { currentStage: PipelineStage }) {
  const stages: PipelineStage[] = [1, 2, 3, 4, 5]
  return (
    <div className="flex items-center gap-0 mb-6">
      {stages.map((stage, i) => {
        const isDone = stage < currentStage
        const isCurrent = stage === currentStage
        return (
          <div key={stage} className="flex items-center flex-1">
            <div className={`
              flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium flex-1 justify-center
              ${isDone ? 'text-primary' : isCurrent ? 'text-foreground' : 'text-muted-foreground/50'}
            `}>
              {isDone
                ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                : isCurrent
                  ? <Circle className="w-3.5 h-3.5 flex-shrink-0 fill-primary/20 stroke-primary" />
                  : <Circle className="w-3.5 h-3.5 flex-shrink-0" />
              }
              <span className="hidden sm:inline">{STAGE_LABELS[stage]}</span>
            </div>
            {i < stages.length - 1 && (
              <div className={`h-px w-3 flex-shrink-0 ${stage < currentStage ? 'bg-primary/40' : 'bg-border'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ============================================================
// Subtask List
// ============================================================

function SubtaskList({ task }: { task: PipelineTask }) {
  const { updateSubtaskStatus } = useTasksStore()

  if (task.subtasks.length === 0) return null

  return (
    <div className="mb-6">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
        子任务
        <span className="ml-2 font-normal normal-case">
          {task.subtasks.filter(s => s.status === 'done').length}/{task.subtasks.length} 完成
        </span>
      </h3>
      <div className="space-y-1">
        {task.subtasks.map(subtask => (
          <div
            key={subtask.id}
            className="flex items-start gap-2.5 px-3 py-2 rounded-lg bg-secondary/50 group"
          >
            <button
              onClick={() => updateSubtaskStatus(
                task.id,
                subtask.id,
                subtask.status === 'done' ? 'pending' : 'done'
              )}
              className="mt-0.5 flex-shrink-0"
            >
              {subtask.status === 'done'
                ? <CheckCircle2 className="w-4 h-4 text-primary" />
                : subtask.status === 'in_progress'
                  ? <Loader2 className="w-4 h-4 text-yellow-500 animate-spin" />
                  : <Circle className="w-4 h-4 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
              }
            </button>
            <div className="flex-1 min-w-0">
              <p className={`text-sm ${subtask.status === 'done' ? 'line-through text-muted-foreground' : ''}`}>
                {subtask.title}
              </p>
              {subtask.description && (
                <p className="text-xs text-muted-foreground mt-0.5">{subtask.description}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ============================================================
// Start Work Button
// ============================================================

function StartWorkButton({ task }: { task: PipelineTask }) {
  const { updateTask } = useTasksStore()
  const isWorking = task.stage >= 3 && task.stage <= 4 && task.resumeHint.length > 0 && !task.resumeHint.startsWith('✓')

  const handleClick = () => {
    if (task.stage === 1) {
      // Advance to stage 2 (breakdown)
      updateTask(task.id, { stage: 2, resumeHint: '正在分析任务上下文...' })
    } else if (task.stage === 2) {
      // Advance to stage 3 (intent confirmation)
      updateTask(task.id, { stage: 3, resumeHint: '等待你确认影响范围' })
    }
  }

  const isDone = task.stage === 5 && task.resumeHint.startsWith('✓')

  return (
    <div className="flex items-center gap-3 mt-2">
      <button
        onClick={handleClick}
        disabled={isDone || isWorking}
        className={`
          flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors
          ${isDone
            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 cursor-default'
            : isWorking
              ? 'bg-primary/10 text-primary cursor-default border border-primary/20'
              : 'bg-primary text-primary-foreground hover:bg-primary/90'
          }
        `}
      >
        {isWorking && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        开始工作
      </button>
      {task.resumeHint && (
        <span className="text-xs text-muted-foreground">{task.resumeHint}</span>
      )}
    </div>
  )
}

// ============================================================
// Task Detail Panel
// ============================================================

function TaskDetail({ task }: { task: PipelineTask }) {
  const { updateTask, deleteTask, upsertSubtasks } = useTasksStore()
  const [requirementDraft, setRequirementDraft] = useState(task.requirement)
  const [isDirty, setIsDirty] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // Sync draft when task changes
  useEffect(() => {
    setRequirementDraft(task.requirement)
    setIsDirty(false)
  }, [task.id, task.requirement])

  const handleRequirementChange = (val: string) => {
    setRequirementDraft(val)
    setIsDirty(val !== task.requirement)
  }

  const handleSaveRequirement = async () => {
    if (!isDirty) return
    const title = requirementDraft.slice(0, 60).replace(/\n/g, ' ')
    await updateTask(task.id, { requirement: requirementDraft, title })
    setIsDirty(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSaveRequirement()
    }
  }

  // Placeholder: parse subtasks from AI response (will be wired to agent later)
  const handleBreakdown = async () => {
    const placeholderSubtasks = [
      { title: '分析现有代码结构', description: '扫描相关模块，了解当前实现' },
      { title: '设计接口方案', description: '确定 API 入参/出参，与前端对齐' },
      { title: '实现后端逻辑', description: '编写 handler、service、数据库操作' },
      { title: '前端页面实现', description: '新增或修改相关页面和组件' },
      { title: '编写单元测试', description: '覆盖核心逻辑和边界情况' },
    ]
    await upsertSubtasks(task.id, placeholderSubtasks)
    await updateTask(task.id, { stage: 2, resumeHint: '子任务已生成，请确认后开始工作' })
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5">
      {/* Pipeline stage bar */}
      <PipelineStageBar currentStage={task.stage} />

      {/* Requirement section */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">需求描述</h3>
          {isDirty && (
            <button
              onClick={handleSaveRequirement}
              className="text-xs text-primary hover:text-primary/80 transition-colors"
            >
              保存 (⌘ Enter)
            </button>
          )}
        </div>
        <textarea
          className="w-full min-h-[100px] text-sm bg-secondary/50 border border-border rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
          placeholder="描述需求..."
          value={requirementDraft}
          onChange={e => handleRequirementChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSaveRequirement}
        />
      </div>

      {/* Stage 1: AI breakdown trigger */}
      {task.stage === 1 && task.subtasks.length === 0 && (
        <div className="mb-6 p-4 rounded-lg border border-dashed border-border bg-secondary/30">
          <p className="text-sm text-muted-foreground mb-3">
            AI 将根据需求描述自动拆解子任务，分析影响范围。
          </p>
          <button
            onClick={handleBreakdown}
            disabled={!task.requirement.trim()}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ClipboardList className="w-3.5 h-3.5" />
            拆解任务
          </button>
        </div>
      )}

      {/* Subtask list */}
      <SubtaskList task={task} />

      {/* Start Work button (visible from Stage 2 onwards) */}
      {task.stage >= 2 && (
        <StartWorkButton task={task} />
      )}

      {/* Danger zone */}
      <div className="mt-10 pt-4 border-t border-border/50">
        {showDeleteConfirm ? (
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">确认删除这个任务？</span>
            <button
              onClick={() => deleteTask(task.id)}
              className="px-3 py-1 text-sm text-destructive border border-destructive/30 rounded-lg hover:bg-destructive/10 transition-colors"
            >
              确认删除
            </button>
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="px-3 py-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              取消
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground/60 hover:text-destructive transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            删除任务
          </button>
        )}
      </div>
    </div>
  )
}

// ============================================================
// Empty State
// ============================================================

function TasksEmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
        <ClipboardList className="w-6 h-6 text-primary" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground mb-1">还没有任务</p>
        <p className="text-xs text-muted-foreground">
          创建一个任务，AI 会帮你拆解需求、规划实现路径
        </p>
      </div>
      <button
        onClick={onNew}
        className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
      >
        <Plus className="w-4 h-4" />
        新建任务
      </button>
    </div>
  )
}

// ============================================================
// Tasks Page
// ============================================================

export function TasksPage() {
  const setView = useAppStore(state => state.setView)
  const currentSpace = useSpaceStore(state => state.currentSpace)

  const {
    tasks,
    selectedTaskId,
    isLoading,
    loadTasks,
    selectTask,
    getSelectedTask,
  } = useTasksStore()

  const [showNewDialog, setShowNewDialog] = useState(false)

  const selectedTask = getSelectedTask()

  // Load tasks when space is available
  useEffect(() => {
    if (currentSpace?.id) {
      loadTasks(currentSpace.id)
    }
  }, [currentSpace?.id, loadTasks])

  // Auto-select first task when list loads
  useEffect(() => {
    if (!selectedTaskId && tasks.length > 0) {
      selectTask(tasks[0].id)
    }
  }, [tasks, selectedTaskId, selectTask])

  return (
    <div className="h-full w-full flex flex-col">
      <Header
        left={
          <>
            <button
              onClick={() => setView('space')}
              className="p-1.5 hover:bg-secondary rounded-lg transition-colors"
              title="返回"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="text-sm font-semibold">任务 & 需求</span>
          </>
        }
        right={
          <button
            onClick={() => setShowNewDialog(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 text-sm hover:bg-secondary rounded-lg transition-colors"
            title="新建任务"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">新建任务</span>
          </button>
        }
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar: task list */}
        <div className="w-64 flex-shrink-0 border-r border-border flex flex-col">
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : tasks.length === 0 ? (
              <div className="px-3 py-6 text-center">
                <p className="text-xs text-muted-foreground">暂无任务</p>
              </div>
            ) : (
              tasks.map(task => (
                <TaskListItem
                  key={task.id}
                  task={task}
                  isSelected={task.id === selectedTaskId}
                  onClick={() => selectTask(task.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* Right panel: task detail */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedTask ? (
            <>
              {/* Task title header */}
              <div className="flex-shrink-0 px-6 pt-5 pb-0">
                <h1 className="text-base font-semibold leading-snug">
                  {selectedTask.title || selectedTask.requirement.slice(0, 80)}
                </h1>
              </div>
              <TaskDetail key={selectedTask.id} task={selectedTask} />
            </>
          ) : (
            <TasksEmptyState onNew={() => setShowNewDialog(true)} />
          )}
        </div>
      </div>

      {/* New task dialog */}
      {showNewDialog && currentSpace && (
        <NewTaskDialog
          spaceId={currentSpace.id}
          onClose={() => setShowNewDialog(false)}
        />
      )}
    </div>
  )
}
