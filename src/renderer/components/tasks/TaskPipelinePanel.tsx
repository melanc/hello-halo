/**
 * Inline pipeline panel shown above ChatView when in task-focus mode.
 *
 * Stage bar doubles as a tab navigator — clicking any stage switches
 * the body to show that stage's content regardless of current progress.
 *
 * Stages: 1=需求识别  2=任务拆解  3=开发计划  4=编码实现  5=验证收尾
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
  Upload,
  Plus,
  X,
  AlertCircle,
  ListChecks,
} from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useTaskStore } from '../../stores/task.store'
import { useChatStore } from '../../stores/chat.store'
import { extractWordDocument, DOC_IMG_PLACEHOLDER_PREFIX } from '../../utils/wordDocumentExtract'
import { buildRequirementIdentifyMessage } from '../../lib/workspace-task-messages'
import type { PipelineStage, PipelineSubtask, PipelineSubtaskStatus, WorkspaceTask } from '../../types'

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/** Extract bullet-point lines (- / • / *) from AI response text as key points. */
function extractKeyPoints(text: string): string[] {
  return text
    .split('\n')
    .filter((line) => /^\s*[-•*]\s+.+/.test(line))
    .map((line) => line.trim().replace(/^[-•*]\s+/, '').trim())
    .filter((pt) => pt.length > 0 && pt.length < 300)
}

/**
 * Waits for a conversation session to finish generating, then returns
 * the content of the last assistant message.
 * Resolves with undefined on timeout (90 s).
 */
function waitForAssistantReply(conversationId: string): Promise<string | undefined> {
  return new Promise<string | undefined>((resolve) => {
    let resolved = false
    const done = (content?: string) => {
      if (resolved) return
      resolved = true
      clearTimeout(timer)
      unsub()
      resolve(content)
    }

    const timer = setTimeout(() => done(undefined), 90_000)

    const unsub = useChatStore.subscribe((state) => {
      const session = state.sessions.get(conversationId)
      if (!session?.isGenerating) {
        const conv = state.conversationCache.get(conversationId)
        const msgs = conv?.messages ?? []
        const last = [...msgs].reverse().find((m) => m.role === 'assistant')
        done(last?.content)
      }
    })

    // Guard: if generation already finished before we subscribed
    const s = useChatStore.getState()
    const sess = s.sessions.get(conversationId)
    if (!sess?.isGenerating) {
      const conv = s.conversationCache.get(conversationId)
      const msgs = conv?.messages ?? []
      const last = [...msgs].reverse().find((m) => m.role === 'assistant')
      done(last?.content)
    }
  })
}

// ─────────────────────────────────────────────
// Stage metadata
// ─────────────────────────────────────────────

const STAGES: { id: PipelineStage; label: string }[] = [
  { id: 1, label: '需求识别' },
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

/** Tab 1 — 需求识别 */
function Tab1Requirements({
  task,
  stage,
  onBreakdown,
}: {
  task: WorkspaceTask
  stage: PipelineStage
  onBreakdown: () => void
}) {
  const { t } = useTranslation()
  const updateTaskRequirementDoc = useTaskStore((s) => s.updateTaskRequirementDoc)
  const updateTaskRequirementKeyPoints = useTaskStore((s) => s.updateTaskRequirementKeyPoints)

  const [descDraft, setDescDraft] = useState(task.requirementDescription ?? '')
  const savedDescRef = useRef(task.requirementDescription ?? '')
  const [isParsingDoc, setIsParsingDoc] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [newPoint, setNewPoint] = useState('')

  // Sync description draft when task updates externally
  useEffect(() => {
    const incoming = task.requirementDescription ?? ''
    if (incoming !== savedDescRef.current) {
      savedDescRef.current = incoming
      setDescDraft(incoming)
    }
  }, [task.requirementDescription])

  const handleDescBlur = useCallback(() => {
    const trimmed = descDraft.trim()
    if (trimmed !== savedDescRef.current) {
      savedDescRef.current = trimmed
      updateTaskRequirementDoc(task.id, task.requirementDocName, task.requirementDocContent, trimmed)
    }
  }, [descDraft, task.id, task.requirementDocName, task.requirementDocContent, updateTaskRequirementDoc])

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    if (!file.name.toLowerCase().endsWith('.docx')) return
    setIsParsingDoc(true)
    try {
      const arrayBuffer = await file.arrayBuffer()
      const { textWithPlaceholders } = await extractWordDocument(arrayBuffer, {
        unsupportedImageLabel: t('Word document image omitted'),
      })
      const normalized = textWithPlaceholders
        .replace(new RegExp(`\\n?\\${DOC_IMG_PLACEHOLDER_PREFIX}\\d+\\]\\n?`, 'g'), '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
      updateTaskRequirementDoc(task.id, file.name, normalized, task.requirementDescription ?? '')
    } finally {
      setIsParsingDoc(false)
    }
  }, [task.id, task.requirementDescription, updateTaskRequirementDoc, t])

  const keyPoints: string[] = task.requirementKeyPoints ?? []

  const handleAddPoint = useCallback(() => {
    const trimmed = newPoint.trim()
    if (!trimmed) return
    updateTaskRequirementKeyPoints(task.id, [...keyPoints, trimmed])
    setNewPoint('')
  }, [newPoint, keyPoints, task.id, updateTaskRequirementKeyPoints])

  const handleRemovePoint = useCallback((idx: number) => {
    updateTaskRequirementKeyPoints(task.id, keyPoints.filter((_, i) => i !== idx))
  }, [keyPoints, task.id, updateTaskRequirementKeyPoints])

  const handlePointKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); handleAddPoint() }
  }, [handleAddPoint])

  const hasContent = !!task.requirementDocName || descDraft.trim().length > 0

  return (
    <div className="space-y-3">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={(e) => void handleFileChange(e)}
        className="hidden"
      />

      {/* Requirement document card — shown when a doc was uploaded */}
      {task.requirementDocName ? (
        <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-secondary/60 border border-border/50">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-muted/80">
            <FileText className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground leading-none mb-0.5">
              {t('需求文档')}
            </p>
            <p className="text-xs font-medium text-foreground truncate">{task.requirementDocName}</p>
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isParsingDoc}
            className="flex-shrink-0 flex items-center gap-1 px-2 py-1 text-[11px] text-muted-foreground border border-border/60 rounded-md hover:bg-secondary hover:text-foreground transition-colors disabled:opacity-50"
          >
            {isParsingDoc
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <Upload className="w-3 h-3" />
            }
            {t('重新上传')}
          </button>
        </div>
      ) : (
        /* Upload button when no doc yet */
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isParsingDoc}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-dashed border-border rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 w-full justify-center"
        >
          {isParsingDoc
            ? <Loader2 className="w-3 h-3 animate-spin" />
            : <Upload className="w-3 h-3" />
          }
          {isParsingDoc ? t('正在解析文档...') : t('上传需求文档 (.docx)')}
        </button>
      )}

      {/* Requirement description — editable textarea */}
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{t('需求描述')}</p>
        <textarea
          className="w-full text-xs bg-secondary/40 border border-border rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50 leading-relaxed"
          rows={4}
          placeholder={t('描述需求，或通过上传文档补充...')}
          value={descDraft}
          onChange={(e) => setDescDraft(e.target.value)}
          onBlur={handleDescBlur}
        />
      </div>

      {/* Requirement key points */}
      <div>
        <div className="flex items-center gap-1 mb-1.5">
          <ListChecks className="w-3 h-3 text-muted-foreground/70 flex-shrink-0" />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('需求要点')}</span>
        </div>
        {keyPoints.length > 0 && (
          <ul className="space-y-1 mb-1.5">
            {keyPoints.map((pt, idx) => (
              <li key={idx} className="flex items-start gap-1.5 group">
                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-primary/50 flex-shrink-0" />
                <span className="flex-1 text-xs leading-snug text-foreground/80">{pt}</span>
                <button
                  type="button"
                  onClick={() => handleRemovePoint(idx)}
                  className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
                  aria-label={t('Remove')}
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-1">
          <input
            type="text"
            className="flex-1 text-xs bg-secondary/40 border border-border rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
            placeholder={t('添加需求要点，按 Enter 确认')}
            value={newPoint}
            onChange={(e) => setNewPoint(e.target.value)}
            onKeyDown={handlePointKeyDown}
          />
          <button
            type="button"
            onClick={handleAddPoint}
            disabled={!newPoint.trim()}
            className="flex-shrink-0 p-1 rounded-md border border-border hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
            aria-label={t('Add point')}
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Breakdown trigger — stage 1 only */}
      {stage === 1 && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBreakdown}
            disabled={!hasContent}
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
  const [checkResult, setCheckResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [isSendingMessage, setIsSendingMessage] = useState(false)

  // When progress advances, follow it
  useEffect(() => {
    setSelectedTab(stage)
  }, [stage])

  // Clear check result when tab changes
  useEffect(() => {
    setCheckResult(null)
  }, [selectedTab])

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

  const getTabCheck = useCallback((tab: PipelineStage): { ok: boolean; message: string } => {
    switch (tab) {
      case 1: {
        const hasContent = !!task.requirementDocName || (task.requirementDescription?.trim() ?? '').length > 0
        if (!hasContent) return { ok: false, message: t('请填写需求描述或上传需求文档') }
        return { ok: true, message: t('需求已就绪，接下来拆解任务，将需求分解为可执行的子任务') }
      }
      case 2: {
        if (subtasks.length === 0) return { ok: false, message: t('请先拆解任务，点击「拆解任务」按钮生成子任务') }
        return { ok: true, message: t('任务拆解完成，接下来制定开发计划，明确涉及项目和改动范围') }
      }
      case 3: {
        const hasPlan = (task.pipelineDevPlan?.trim() ?? '').length > 0
        if (!hasPlan) return { ok: false, message: t('请填写代码改动范围，描述要改哪些模块、文件或接口') }
        return { ok: true, message: t('开发计划已确认，接下来进入编码实现阶段') }
      }
      case 4:
        return { ok: true, message: t('编码任务进行中，完成后进入验证收尾阶段') }
      case 5:
        return { ok: true, message: t('任务已完成，请检查代码质量并提交') }
      default:
        return { ok: true, message: '' }
    }
  }, [task, subtasks, t])

  const handleStartWork = useCallback(async () => {
    const check = getTabCheck(selectedTab)
    setCheckResult(check)
    if (!check.ok) return

    if (selectedTab === 1) {
      // Send requirement to AI for analysis, then auto-populate key points
      setIsSendingMessage(true)
      try {
        const chat = useChatStore.getState()
        await chat.sendMessage(buildRequirementIdentifyMessage(task, t))
        // Wait for the AI to finish and parse the bullet points from its reply
        const reply = await waitForAssistantReply(task.conversationId)
        if (reply) {
          const points = extractKeyPoints(reply)
          if (points.length > 0) {
            useTaskStore.getState().updateTaskRequirementKeyPoints(task.id, points)
          }
        }
      } finally {
        setIsSendingMessage(false)
      }
    } else if (selectedTab === 2 && stage <= 2) {
      updateTaskPipelineState(task.id, { stage: 3, pipelineResumeHint: t('等待你确认影响范围') })
      setSelectedTab(3)
    } else if (selectedTab === 3 && stage <= 3) {
      updateTaskPipelineState(task.id, { stage: 4, pipelineResumeHint: t('进入编码阶段') })
      setSelectedTab(4)
    } else if (selectedTab === 4 && stage <= 4) {
      updateTaskPipelineState(task.id, { stage: 5, pipelineResumeHint: t('等待验收') })
      setSelectedTab(5)
    }
  }, [selectedTab, stage, task, getTabCheck, updateTaskPipelineState, t])

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
          <div className="overflow-y-auto px-3 pt-1 pb-3" style={{ maxHeight: 440 }}>
            {selectedTab === 1 && (
              <Tab1Requirements
                task={task}
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

          {/* Action row — always visible */}
          <div className="flex flex-col border-t border-border/50">
            <div className="flex items-center gap-2 px-3 py-2">
              {resumeHint && !checkResult && (
                <span className="flex-1 text-[11px] text-muted-foreground truncate">{resumeHint}</span>
              )}
              {(!resumeHint || checkResult) && <span className="flex-1" />}

              {stage >= 2 && (
                <button
                  type="button"
                  onClick={handleIdentify}
                  disabled={identifyDone}
                  className={`
                    flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors
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
              )}

              <button
                type="button"
                onClick={() => void handleStartWork()}
                disabled={isSendingMessage}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-70"
              >
                {isSendingMessage && <Loader2 className="w-3 h-3 animate-spin" />}
                {t('开始工作')}
              </button>
            </div>

            {/* Check result banner */}
            {checkResult && (
              <div className={`mx-3 mb-2 flex items-start gap-1.5 px-2.5 py-1.5 rounded-lg text-xs ${
                checkResult.ok
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                  : 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300'
              }`}>
                {checkResult.ok
                  ? <CheckCircle2 className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  : <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                }
                <span className="leading-snug">{checkResult.message}</span>
              </div>
            )}
          </div>
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
