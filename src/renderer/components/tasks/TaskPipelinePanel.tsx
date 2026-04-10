/**
 * Inline pipeline panel shown above ChatView when in task-focus mode.
 * Displays the 5-stage workflow (requirements → breakdown → intent → coding → review)
 * with subtasks and action buttons.
 */

import { useState, useCallback } from 'react'
import {
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Circle,
  Loader2,
  ClipboardList,
} from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useTaskStore } from '../../stores/task.store'
import type { PipelineStage, PipelineSubtask, PipelineSubtaskStatus, WorkspaceTask } from '../../types'

// ─────────────────────────────────────────────
// Stage metadata
// ─────────────────────────────────────────────

const STAGES: { id: PipelineStage; labelKey: string }[] = [
  { id: 1, labelKey: '需求理解' },
  { id: 2, labelKey: '任务拆解' },
  { id: 3, labelKey: '意图确认' },
  { id: 4, labelKey: '编码实现' },
  { id: 5, labelKey: '验证收尾' },
]

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────

function StageBar({ stage }: { stage: PipelineStage }) {
  return (
    <div className="flex items-center gap-0 flex-1 min-w-0">
      {STAGES.map((s, i) => {
        const isDone = s.id < stage
        const isCurrent = s.id === stage
        return (
          <div key={s.id} className="flex items-center flex-1 min-w-0">
            <div
              className={`
                flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium flex-1 justify-center min-w-0
                ${isDone ? 'text-primary' : isCurrent ? 'text-foreground' : 'text-muted-foreground/40'}
              `}
            >
              {isDone ? (
                <CheckCircle2 className="w-3 h-3 flex-shrink-0" />
              ) : isCurrent ? (
                <Circle className="w-3 h-3 flex-shrink-0 fill-primary/20 stroke-primary" />
              ) : (
                <Circle className="w-3 h-3 flex-shrink-0" />
              )}
              <span className="hidden md:inline truncate">{s.labelKey}</span>
            </div>
            {i < STAGES.length - 1 && (
              <div className={`h-px w-2 flex-shrink-0 ${s.id < stage ? 'bg-primary/40' : 'bg-border'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function SubtaskItem({
  subtask,
  onToggle,
}: {
  subtask: PipelineSubtask
  onToggle: (id: string, next: PipelineSubtaskStatus) => void
}) {
  const isDone = subtask.status === 'done'
  const isRunning = subtask.status === 'in_progress'
  return (
    <div className="flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-secondary/60 group">
      <button
        type="button"
        onClick={() => onToggle(subtask.id, isDone ? 'pending' : 'done')}
        className="mt-0.5 flex-shrink-0"
        aria-label={isDone ? 'Mark pending' : 'Mark done'}
      >
        {isDone ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
        ) : isRunning ? (
          <Loader2 className="w-3.5 h-3.5 text-yellow-500 animate-spin" />
        ) : (
          <Circle className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
        )}
      </button>
      <div className="flex-1 min-w-0">
        <p className={`text-xs leading-snug ${isDone ? 'line-through text-muted-foreground' : ''}`}>
          {subtask.title}
        </p>
        {subtask.description && (
          <p className="text-[11px] text-muted-foreground/70 mt-0.5 leading-snug">{subtask.description}</p>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// Main panel
// ─────────────────────────────────────────────

interface TaskPipelinePanelProps {
  task: WorkspaceTask
}

function TaskPipelinePanelInner({ task }: TaskPipelinePanelProps) {
  const { t } = useTranslation()
  const updateTaskPipelineState = useTaskStore((s) => s.updateTaskPipelineState)

  const stage: PipelineStage = task.pipelineStage ?? 1
  const subtasks: PipelineSubtask[] = task.pipelineSubtasks ?? []
  const resumeHint = task.pipelineResumeHint ?? ''

  const [collapsed, setCollapsed] = useState(false)

  const requirementText =
    task.requirementDescription?.trim() ||
    task.requirementDocContent?.trim() ||
    ''

  const doneCount = subtasks.filter((s) => s.status === 'done').length

  const handleToggleSubtask = useCallback(
    (subtaskId: string, next: PipelineSubtaskStatus) => {
      const updated = subtasks.map((s) =>
        s.id === subtaskId ? { ...s, status: next } : s
      )
      updateTaskPipelineState(task.id, { pipelineSubtasks: updated })
    },
    [subtasks, task.id, updateTaskPipelineState]
  )

  // Placeholder breakdown — will be replaced with real AI call
  const handleBreakdown = useCallback(() => {
    const placeholders: PipelineSubtask[] = [
      { id: `st-${Date.now()}-1`, title: t('分析现有代码结构'), description: t('扫描相关模块，了解当前实现'), status: 'pending' },
      { id: `st-${Date.now()}-2`, title: t('设计接口方案'), description: t('确定 API 入参/出参，与前端对齐'), status: 'pending' },
      { id: `st-${Date.now()}-3`, title: t('实现后端逻辑'), description: t('编写 handler、service、数据库操作'), status: 'pending' },
      { id: `st-${Date.now()}-4`, title: t('前端页面实现'), description: t('新增或修改相关页面和组件'), status: 'pending' },
      { id: `st-${Date.now()}-5`, title: t('编写单元测试'), description: t('覆盖核心逻辑和边界情况'), status: 'pending' },
    ]
    updateTaskPipelineState(task.id, {
      stage: 2,
      pipelineSubtasks: placeholders,
      pipelineResumeHint: t('子任务已生成，请确认后开始工作'),
    })
  }, [task.id, updateTaskPipelineState, t])

  const handleStartWork = useCallback(() => {
    if (stage === 2) {
      updateTaskPipelineState(task.id, {
        stage: 3,
        pipelineResumeHint: t('等待你确认影响范围'),
      })
    }
  }, [stage, task.id, updateTaskPipelineState, t])

  return (
    <div className="border-b border-border bg-card/60 flex flex-col">
      {/* Panel header — always visible */}
      <div className="flex items-center gap-2 px-3 py-2 min-h-[40px]">
        <StageBar stage={stage} />
        {/* Progress badge when subtasks exist */}
        {subtasks.length > 0 && (
          <span className="flex-shrink-0 text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-secondary">
            {doneCount}/{subtasks.length}
          </span>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex-shrink-0 p-1 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
          aria-label={collapsed ? t('Expand') : t('Collapse')}
        >
          {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Panel body — collapsible */}
      {!collapsed && (
        <div className="overflow-y-auto" style={{ maxHeight: 260 }}>
          <div className="px-3 pb-3 space-y-3">
            {/* Requirement summary */}
            {requirementText && (
              <div>
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
                  {t('需求描述')}
                </p>
                <p className="text-xs text-foreground/80 leading-relaxed line-clamp-3 whitespace-pre-wrap">
                  {requirementText}
                </p>
              </div>
            )}

            {/* Stage 1: trigger breakdown */}
            {stage === 1 && subtasks.length === 0 && (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleBreakdown}
                  disabled={!requirementText}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ClipboardList className="w-3 h-3" />
                  {t('拆解任务')}
                </button>
                <span className="text-[11px] text-muted-foreground">
                  {t('AI 自动拆解子任务，分析影响范围')}
                </span>
              </div>
            )}

            {/* Subtasks */}
            {subtasks.length > 0 && (
              <div>
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
                  {t('子任务')}
                </p>
                <div className="space-y-0.5">
                  {subtasks.map((st) => (
                    <SubtaskItem key={st.id} subtask={st} onToggle={handleToggleSubtask} />
                  ))}
                </div>
              </div>
            )}

            {/* Stage 2+: start work */}
            {stage >= 2 && (
              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleStartWork}
                  disabled={stage >= 3}
                  className={`
                    flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors
                    ${stage >= 3
                      ? 'bg-primary/10 text-primary cursor-default border border-primary/20'
                      : 'bg-primary text-primary-foreground hover:bg-primary/90'
                    }
                  `}
                >
                  {t('开始工作')}
                </button>
                {resumeHint && (
                  <span className="text-[11px] text-muted-foreground">{resumeHint}</span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Reads the active task from the task store and renders the pipeline panel.
 * Returns null when not in task-focus mode.
 */
export function TaskPipelinePanel() {
  const activeTaskId = useTaskStore((s) => s.activeTaskId)
  const tasks = useTaskStore((s) => s.tasks)

  if (!activeTaskId) return null
  const task = tasks.find((t) => t.id === activeTaskId)
  if (!task) return null

  return <TaskPipelinePanelInner task={task} />
}
