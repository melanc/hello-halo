/**
 * Inline pipeline panel shown above ChatView when in task-focus mode.
 *
 * Stage bar doubles as a tab navigator — clicking any stage switches
 * the body to show that stage's content regardless of current progress.
 *
 * Stages: 1=需求理解  2=任务拆解  3=开发计划  4=编码实现  5=验证收尾
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import {
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Circle,
  Loader2,
  ClipboardList,
  ScanText,
  FolderOpen,
  Code2,
  FileText,
} from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useTaskStore } from '../../stores/task.store'
import type { PipelineStage, PipelineSubtask, PipelineSubtaskStatus, WorkspaceTask } from '../../types'

// ─────────────────────────────────────────────
// Stage metadata
// ─────────────────────────────────────────────

const STAGES: { id: PipelineStage; label: string }[] = [
  { id: 1, label: '需求理解' },
  { id: 2, label: '任务拆解' },
  { id: 3, label: '开发计划' },
  { id: 4, label: '编码实现' },
  { id: 5, label: '验证收尾' },
]

// ─────────────────────────────────────────────
// StageTabBar — progress indicator + tab clicks
// ─────────────────────────────────────────────

function StageTabBar({
  stage,
  selectedTab,
  onSelect,
}: {
  stage: PipelineStage
  selectedTab: PipelineStage
  onSelect: (id: PipelineStage) => void
}) {
  return (
    <div className="flex items-center gap-0 flex-1 min-w-0">
      {STAGES.map((s, i) => {
        const isDone = s.id < stage
        const isCurrent = s.id === stage
        const isSelected = s.id === selectedTab

        return (
          <div key={s.id} className="flex items-center flex-1 min-w-0">
            <button
              type="button"
              onClick={() => onSelect(s.id)}
              className={`
                flex items-center gap-1 px-1.5 py-1 rounded text-[11px] font-medium
                flex-1 justify-center min-w-0 transition-colors
                ${isSelected
                  ? 'bg-secondary text-foreground'
                  : isDone
                    ? 'text-primary hover:bg-secondary/60'
                    : isCurrent
                      ? 'text-foreground hover:bg-secondary/60'
                      : 'text-muted-foreground/40 hover:text-muted-foreground hover:bg-secondary/40'
                }
              `}
            >
              {isDone ? (
                <CheckCircle2 className="w-3 h-3 flex-shrink-0" />
              ) : isCurrent ? (
                <Circle className="w-3 h-3 flex-shrink-0 fill-primary/20 stroke-primary" />
              ) : (
                <Circle className="w-3 h-3 flex-shrink-0" />
              )}
              <span className="hidden sm:inline truncate">{s.label}</span>
            </button>
            {i < STAGES.length - 1 && (
              <div className={`h-px w-2 flex-shrink-0 ${s.id < stage ? 'bg-primary/40' : 'bg-border'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────
// SubtaskItem
// ─────────────────────────────────────────────

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
// Tab bodies
// ─────────────────────────────────────────────

/** Tab 1 — 需求理解 */
function Tab1Requirements({
  requirementDocName,
  requirementText,
  stage,
  onBreakdown,
}: {
  requirementDocName: string
  requirementText: string
  stage: PipelineStage
  onBreakdown: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-3">
      {/* Requirement document — shown above description when a doc was uploaded */}
      {requirementDocName && (
        <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-secondary/60 border border-border/50">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-muted/80">
            <FileText className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground leading-none mb-0.5">
              {t('需求文档')}
            </p>
            <p className="text-xs font-medium text-foreground truncate">{requirementDocName}</p>
          </div>
        </div>
      )}

      {/* Requirement description */}
      {requirementText ? (
        <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap">{requirementText}</p>
      ) : (
        <p className="text-xs text-muted-foreground/50 italic">{t('暂无需求描述')}</p>
      )}

      {stage === 1 && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBreakdown}
            disabled={!requirementText && !requirementDocName}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ClipboardList className="w-3 h-3" />
            {t('拆解任务')}
          </button>
          <span className="text-[11px] text-muted-foreground">{t('AI 自动拆解子任务，分析影响范围')}</span>
        </div>
      )}
    </div>
  )
}

/** Tab 2 — 任务拆解 */
function Tab2Breakdown({
  subtasks,
  stage,
  onBreakdown,
  onToggle,
}: {
  subtasks: PipelineSubtask[]
  stage: PipelineStage
  onBreakdown: () => void
  onToggle: (id: string, next: PipelineSubtaskStatus) => void
}) {
  const { t } = useTranslation()
  if (subtasks.length === 0) {
    return (
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBreakdown}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
        >
          <ClipboardList className="w-3 h-3" />
          {t('拆解任务')}
        </button>
        <span className="text-[11px] text-muted-foreground">{t('AI 自动拆解子任务，分析影响范围')}</span>
      </div>
    )
  }
  return (
    <div className="space-y-0.5">
      {subtasks.map((st) => (
        <SubtaskItem key={st.id} subtask={st} onToggle={onToggle} />
      ))}
      {stage === 1 && (
        <button
          type="button"
          onClick={onBreakdown}
          className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-secondary transition-colors text-muted-foreground"
        >
          {t('重新拆解')}
        </button>
      )}
    </div>
  )
}

/** Tab 3 — 开发计划 */
function Tab3DevPlan({
  task,
  onSaveDevPlan,
}: {
  task: WorkspaceTask
  onSaveDevPlan: (text: string) => void
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(task.pipelineDevPlan ?? '')
  const savedRef = useRef(task.pipelineDevPlan ?? '')

  // Sync when task changes externally
  useEffect(() => {
    const incoming = task.pipelineDevPlan ?? ''
    if (incoming !== savedRef.current) {
      savedRef.current = incoming
      setDraft(incoming)
    }
  }, [task.pipelineDevPlan])

  const handleBlur = useCallback(() => {
    if (draft !== savedRef.current) {
      savedRef.current = draft
      onSaveDevPlan(draft)
    }
  }, [draft, onSaveDevPlan])

  const allDirs = Array.from(
    new Set([...(task.projectDirs ?? []), ...(task.touchedProjectDirs ?? [])])
  ).filter(Boolean)

  return (
    <div className="space-y-3">
      {/* 涉及项目 */}
      <div>
        <div className="flex items-center gap-1 mb-1.5">
          <FolderOpen className="w-3 h-3 text-muted-foreground/70 flex-shrink-0" />
          <span className="text-[11px] text-muted-foreground">{t('涉及项目')}</span>
        </div>
        {allDirs.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {allDirs.map((dir) => (
              <span
                key={dir}
                className="inline-flex items-center px-2 py-0.5 rounded-md bg-secondary text-[11px] text-foreground/80 font-mono"
              >
                {dir}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground/50 italic">{t('暂无项目，AI 识别需求后自动填入')}</p>
        )}
      </div>

      {/* 代码改动范围 */}
      <div>
        <div className="flex items-center gap-1 mb-1.5">
          <Code2 className="w-3 h-3 text-muted-foreground/70 flex-shrink-0" />
          <span className="text-[11px] text-muted-foreground">{t('代码改动范围')}</span>
        </div>
        <textarea
          className="w-full text-xs bg-secondary/40 border border-border rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50 leading-relaxed"
          rows={3}
          placeholder={t('描述要改哪些模块、文件或接口，AI 会帮你填写...')}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={handleBlur}
        />
      </div>
    </div>
  )
}

/** Tab 4 — 编码实现 (placeholder) */
function Tab4Coding() {
  const { t } = useTranslation()
  return (
    <p className="text-xs text-muted-foreground/60 italic">{t('AI 将在此阶段自动执行编码任务')}</p>
  )
}

/** Tab 5 — 验证收尾 (placeholder) */
function Tab5Review() {
  const { t } = useTranslation()
  return (
    <p className="text-xs text-muted-foreground/60 italic">{t('AI 将在此阶段进行静态审查和单元测试')}</p>
  )
}

// ─────────────────────────────────────────────
// Main panel inner
// ─────────────────────────────────────────────

function TaskPipelinePanelInner({ task }: { task: WorkspaceTask }) {
  const { t } = useTranslation()
  const updateTaskPipelineState = useTaskStore((s) => s.updateTaskPipelineState)
  const markRequirementIdentifyUsed = useTaskStore((s) => s.markRequirementIdentifyUsed)

  const stage: PipelineStage = task.pipelineStage ?? 1
  const subtasks: PipelineSubtask[] = task.pipelineSubtasks ?? []
  const resumeHint = task.pipelineResumeHint ?? ''
  const identifyDone = task.requirementIdentifyUsed ?? false

  // selectedTab follows progress stage, but user can freely switch
  const [selectedTab, setSelectedTab] = useState<PipelineStage>(stage)
  const [collapsed, setCollapsed] = useState(false)

  // When progress advances, follow it
  useEffect(() => {
    setSelectedTab(stage)
  }, [stage])

  const requirementText =
    task.requirementDescription?.trim() ||
    task.requirementDocContent?.trim() ||
    ''

  const doneCount = subtasks.filter((s) => s.status === 'done').length

  // ── handlers ──

  const handleToggleSubtask = useCallback(
    (subtaskId: string, next: PipelineSubtaskStatus) => {
      const updated = subtasks.map((s) => (s.id === subtaskId ? { ...s, status: next } : s))
      updateTaskPipelineState(task.id, { pipelineSubtasks: updated })
    },
    [subtasks, task.id, updateTaskPipelineState]
  )

  const handleBreakdown = useCallback(() => {
    const now = Date.now()
    const placeholders: PipelineSubtask[] = [
      { id: `st-${now}-1`, title: t('分析现有代码结构'), description: t('扫描相关模块，了解当前实现'), status: 'pending' },
      { id: `st-${now}-2`, title: t('设计接口方案'), description: t('确定 API 入参/出参，与前端对齐'), status: 'pending' },
      { id: `st-${now}-3`, title: t('实现后端逻辑'), description: t('编写 handler、service、数据库操作'), status: 'pending' },
      { id: `st-${now}-4`, title: t('前端页面实现'), description: t('新增或修改相关页面和组件'), status: 'pending' },
      { id: `st-${now}-5`, title: t('编写单元测试'), description: t('覆盖核心逻辑和边界情况'), status: 'pending' },
    ]
    updateTaskPipelineState(task.id, {
      stage: 2,
      pipelineSubtasks: placeholders,
      pipelineResumeHint: t('子任务已生成，请确认后开始工作'),
    })
    setSelectedTab(2)
  }, [task.id, updateTaskPipelineState, t])

  const handleIdentify = useCallback(() => {
    if (identifyDone) return
    markRequirementIdentifyUsed(task.id)
    updateTaskPipelineState(task.id, { pipelineResumeHint: t('意图已识别，可以开始工作') })
  }, [identifyDone, task.id, markRequirementIdentifyUsed, updateTaskPipelineState, t])

  const handleStartWork = useCallback(() => {
    if (stage === 2) {
      updateTaskPipelineState(task.id, { stage: 3, pipelineResumeHint: t('等待你确认影响范围') })
    }
  }, [stage, task.id, updateTaskPipelineState, t])

  const handleSaveDevPlan = useCallback(
    (text: string) => updateTaskPipelineState(task.id, { pipelineDevPlan: text }),
    [task.id, updateTaskPipelineState]
  )

  // ── render ──

  return (
    <div className="border-b border-border bg-card/60 flex flex-col">
      {/* Header: tab bar + progress badge + collapse toggle */}
      <div className="flex items-center gap-2 px-3 py-2 min-h-[40px]">
        <StageTabBar stage={stage} selectedTab={selectedTab} onSelect={setSelectedTab} />
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

      {/* Body */}
      {!collapsed && (
        <div className="flex flex-col">
          {/* Tab content */}
          <div className="overflow-y-auto px-3 pt-1 pb-3" style={{ maxHeight: 240 }}>
            {selectedTab === 1 && (
              <Tab1Requirements
                requirementDocName={task.requirementDocName ?? ''}
                requirementText={requirementText}
                stage={stage}
                onBreakdown={handleBreakdown}
              />
            )}
            {selectedTab === 2 && (
              <Tab2Breakdown
                subtasks={subtasks}
                stage={stage}
                onBreakdown={handleBreakdown}
                onToggle={handleToggleSubtask}
              />
            )}
            {selectedTab === 3 && (
              <Tab3DevPlan task={task} onSaveDevPlan={handleSaveDevPlan} />
            )}
            {selectedTab === 4 && <Tab4Coding />}
            {selectedTab === 5 && <Tab5Review />}
          </div>

          {/* Action row — always shown when stage ≥ 2 */}
          {stage >= 2 && (
            <div className="flex items-center gap-2 px-3 py-2 border-t border-border/50 flex-wrap">
              <button
                type="button"
                onClick={handleIdentify}
                disabled={identifyDone}
                className={`
                  flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors
                  ${identifyDone
                    ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300 border border-sky-200 dark:border-sky-700 cursor-default'
                    : 'border border-border hover:bg-secondary text-foreground'
                  }
                `}
              >
                {identifyDone
                  ? <CheckCircle2 className="w-3 h-3" />
                  : <ScanText className="w-3 h-3 opacity-70" />
                }
                {identifyDone ? t('意图已识别') : t('意图识别')}
              </button>

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
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────

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
