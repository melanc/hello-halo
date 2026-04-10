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
  AlertCircle,
  Pencil,
  Plus,
} from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useTaskStore } from '../../stores/task.store'
import { useChatStore } from '../../stores/chat.store'
import { extractWordDocument, DOC_IMG_PLACEHOLDER_PREFIX } from '../../utils/wordDocumentExtract'
import {
  buildRequirementIdentifyMessage,
  buildIntentAnalysisMessage,
  buildTaskBreakdownExecuteMessage,
  buildDevPlanExecuteMessage,
  buildCodingKickoffMessage,
} from '../../lib/workspace-task-messages'
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

/** Parse bullet-point lines from AI breakdown reply into PipelineSubtask objects. */
function extractSubtasks(text: string): PipelineSubtask[] {
  const now = Date.now()
  return text
    .split('\n')
    .filter((line) => /^\s*[-•*]\s+.+/.test(line))
    .map((line, i) => {
      const raw = line.trim().replace(/^[-•*]\s+/, '').trim()
      const colonIdx = raw.search(/[:：]/)
      const title = colonIdx > 0 ? raw.slice(0, colonIdx).trim() : raw
      const description = colonIdx > 0 ? raw.slice(colonIdx + 1).trim() : ''
      return { id: `st-${now}-${i}`, title, description, status: 'pending' as PipelineSubtaskStatus }
    })
    .filter((st) => st.title.length > 0 && st.title.length < 200)
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
  onEdit,
  onRemove,
}: {
  subtask: PipelineSubtask
  onToggle: (id: string, next: PipelineSubtaskStatus) => void
  onEdit: (id: string, title: string, description: string) => void
  onRemove?: (id: string) => void
}) {
  const { t } = useTranslation()
  const isNewEmpty = subtask.title === ''
  const [isEditing, setIsEditing] = useState(isNewEmpty)
  const [titleDraft, setTitleDraft] = useState(subtask.title)
  const [descDraft, setDescDraft] = useState(subtask.description ?? '')
  const titleInputRef = useRef<HTMLInputElement>(null)
  const descTextareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (isEditing) titleInputRef.current?.focus()
  }, [isEditing])

  // Auto-resize description textarea whenever its content changes
  useEffect(() => {
    const el = descTextareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [descDraft, isEditing])

  // Sync drafts when subtask is updated externally (e.g. after AI re-generates)
  useEffect(() => {
    if (!isEditing) {
      setTitleDraft(subtask.title)
      setDescDraft(subtask.description ?? '')
    }
  }, [subtask.title, subtask.description, isEditing])

  const handleSave = useCallback(() => {
    const title = titleDraft.trim()
    if (!title) return
    onEdit(subtask.id, title, descDraft.trim())
    setIsEditing(false)
  }, [titleDraft, descDraft, subtask.id, onEdit])

  const handleCancel = useCallback(() => {
    if (isNewEmpty && onRemove) {
      onRemove(subtask.id)
      return
    }
    setTitleDraft(subtask.title)
    setDescDraft(subtask.description ?? '')
    setIsEditing(false)
  }, [isNewEmpty, onRemove, subtask.id, subtask.title, subtask.description])

  const isDone = subtask.status === 'done'
  const isRunning = subtask.status === 'in_progress'

  if (isEditing) {
    return (
      <div className="flex flex-col gap-1.5 px-2 py-2 rounded-lg bg-secondary/60 border border-border/50">
        <input
          ref={titleInputRef}
          className="w-full text-xs bg-background border border-border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder={t('子任务标题')}
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave()
            if (e.key === 'Escape') handleCancel()
          }}
        />
        <textarea
          ref={descTextareaRef}
          className="w-full text-[11px] bg-background border border-border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50 resize-none overflow-hidden leading-relaxed"
          rows={3}
          placeholder={t('简要说明（可选）')}
          value={descDraft}
          onChange={(e) => setDescDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') handleCancel()
          }}
        />
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={handleSave}
            disabled={!titleDraft.trim()}
            className="px-2.5 py-0.5 text-[11px] bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {t('保存')}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="px-2.5 py-0.5 text-[11px] border border-border rounded hover:bg-secondary text-muted-foreground transition-colors"
          >
            {t('取消')}
          </button>
        </div>
      </div>
    )
  }

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
      <button
        type="button"
        onClick={() => setIsEditing(true)}
        className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
        aria-label={t('Edit')}
      >
        <Pencil className="w-3 h-3" />
      </button>
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
  const updateTaskRequirementAnalysis = useTaskStore((s) => s.updateTaskRequirementAnalysis)

  // Requirement description draft
  const [descDraft, setDescDraft] = useState(task.requirementDescription ?? '')
  const savedDescRef = useRef(task.requirementDescription ?? '')
  const [isParsingDoc, setIsParsingDoc] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Requirement analysis draft (full structured text from AI)
  const [analysisDraft, setAnalysisDraft] = useState(task.requirementAnalysis ?? '')
  const savedAnalysisRef = useRef(task.requirementAnalysis ?? '')

  // Sync description draft when task updates externally
  useEffect(() => {
    const incoming = task.requirementDescription ?? ''
    if (incoming !== savedDescRef.current) {
      savedDescRef.current = incoming
      setDescDraft(incoming)
    }
  }, [task.requirementDescription])

  // Sync analysis draft when task updates externally (e.g. after AI writes it)
  useEffect(() => {
    const incoming = task.requirementAnalysis ?? ''
    if (incoming !== savedAnalysisRef.current) {
      savedAnalysisRef.current = incoming
      setAnalysisDraft(incoming)
    }
  }, [task.requirementAnalysis])

  const handleDescBlur = useCallback(() => {
    const trimmed = descDraft.trim()
    if (trimmed !== savedDescRef.current) {
      savedDescRef.current = trimmed
      updateTaskRequirementDoc(task.id, task.requirementDocName, task.requirementDocContent, trimmed)
    }
  }, [descDraft, task.id, task.requirementDocName, task.requirementDocContent, updateTaskRequirementDoc])

  const handleAnalysisBlur = useCallback(() => {
    const trimmed = analysisDraft.trim()
    if (trimmed !== savedAnalysisRef.current) {
      savedAnalysisRef.current = trimmed
      updateTaskRequirementAnalysis(task.id, trimmed)
    }
  }, [analysisDraft, task.id, updateTaskRequirementAnalysis])

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

      {/* Requirement analysis — full structured AI output, editable */}
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{t('需求分析')}</p>
        {analysisDraft ? (
          <textarea
            className="w-full text-xs bg-secondary/40 border border-border rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-ring leading-relaxed font-[inherit]"
            rows={12}
            value={analysisDraft}
            onChange={(e) => setAnalysisDraft(e.target.value)}
            onBlur={handleAnalysisBlur}
          />
        ) : (
          <p className="text-[11px] text-muted-foreground/50 italic px-0.5">
            {t('Click "Start" to let AI analyse the requirement and fill this section')}
          </p>
        )}
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
  onEdit,
  onAdd,
  onRemove,
}: {
  subtasks: PipelineSubtask[]
  stage: PipelineStage
  onBreakdown: () => void
  onToggle: (id: string, next: PipelineSubtaskStatus) => void
  onEdit: (id: string, title: string, description: string) => void
  onAdd: () => void
  onRemove: (id: string) => void
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
        <SubtaskItem key={st.id} subtask={st} onToggle={onToggle} onEdit={onEdit} onRemove={onRemove} />
      ))}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-dashed border-border rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
        >
          <Plus className="w-3 h-3" />
          {t('添加子任务')}
        </button>
        {stage === 1 && (
          <button
            type="button"
            onClick={onBreakdown}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-border rounded-lg hover:bg-secondary transition-colors text-muted-foreground"
          >
            {t('重新拆解')}
          </button>
        )}
      </div>
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
          rows={12}
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

  const stage: PipelineStage = task.pipelineStage ?? 1
  const subtasks: PipelineSubtask[] = task.pipelineSubtasks ?? []
  const resumeHint = task.pipelineResumeHint ?? ''

  // selectedTab follows progress stage, but user can freely switch
  const [selectedTab, setSelectedTab] = useState<PipelineStage>(stage)
  const [collapsed, setCollapsed] = useState(false)
  const [checkResult, setCheckResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [isSendingMessage, setIsSendingMessage] = useState(false)
  const [isIdentifying, setIsIdentifying] = useState(false)

  // Resizable content area
  const [contentHeight, setContentHeight] = useState(440)
  const contentHeightRef = useRef(440)

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = contentHeightRef.current

    // Inject a global style that forces ns-resize cursor on every element
    // and disables user-select/pointer-events during the drag.
    // This is more reliable than setting body styles, which child elements can override.
    const dragStyle = document.createElement('style')
    dragStyle.textContent = '* { cursor: ns-resize !important; user-select: none !important; }'
    document.head.appendChild(dragStyle)

    const onMove = (ev: MouseEvent) => {
      const newH = Math.max(120, startH + ev.clientY - startY)
      contentHeightRef.current = newH
      setContentHeight(newH)
    }
    const onUp = () => {
      dragStyle.remove()
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, []) // stable — reads height from ref, not from state

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

  const handleEditSubtask = useCallback(
    (subtaskId: string, title: string, description: string) => {
      const updated = subtasks.map((s) => (s.id === subtaskId ? { ...s, title, description } : s))
      updateTaskPipelineState(task.id, { pipelineSubtasks: updated })
    },
    [subtasks, task.id, updateTaskPipelineState]
  )

  const handleAddSubtask = useCallback(() => {
    const newSubtask: PipelineSubtask = {
      id: `st-${Date.now()}-new`,
      title: '',
      description: '',
      status: 'pending',
    }
    updateTaskPipelineState(task.id, { pipelineSubtasks: [...subtasks, newSubtask] })
  }, [subtasks, task.id, updateTaskPipelineState])

  const handleRemoveSubtask = useCallback(
    (subtaskId: string) => {
      updateTaskPipelineState(task.id, { pipelineSubtasks: subtasks.filter((s) => s.id !== subtaskId) })
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

  const handleIdentifyIntent = useCallback(async () => {
    if (isIdentifying || isSendingMessage) return
    setIsIdentifying(true)
    try {
      const chat = useChatStore.getState()
      await chat.sendMessage(
        buildIntentAnalysisMessage(
          selectedTab,
          task,
          { subtasks, keyPoints: task.requirementKeyPoints ?? [] },
          t
        )
      )
    } finally {
      setIsIdentifying(false)
    }
  }, [isIdentifying, isSendingMessage, selectedTab, task, subtasks, t])

  const getTabCheck = useCallback((tab: PipelineStage): { ok: boolean; message: string } => {
    switch (tab) {
      case 1: {
        const hasContent = !!task.requirementDocName || (task.requirementDescription?.trim() ?? '').length > 0
        if (!hasContent) return { ok: false, message: t('请填写需求描述或上传需求文档') }
        return { ok: true, message: t('AI 将识别需求要点，自动填入列表') }
      }
      case 2: {
        const hasContext =
          (task.requirementKeyPoints?.length ?? 0) > 0 ||
          !!task.requirementDocContent?.trim() ||
          !!task.requirementDescription?.trim()
        if (!hasContext) return { ok: false, message: t('请先在需求识别中上传文档或填写描述') }
        return { ok: true, message: t('AI 将按讨论结果生成子任务列表') }
      }
      case 3: {
        if (subtasks.length === 0) return { ok: false, message: t('请先在任务拆解中生成子任务') }
        return { ok: true, message: t('AI 将按讨论结果生成开发计划') }
      }
      case 4:
        return { ok: true, message: t('AI 将按照当前计划执行编码') }
      case 5:
        return { ok: true, message: t('AI 将进行代码审查和测试') }
      default:
        return { ok: true, message: '' }
    }
  }, [task, subtasks, t])

  const handleStartWork = useCallback(async () => {
    const check = getTabCheck(selectedTab)
    setCheckResult(check)
    if (!check.ok) return

    setIsSendingMessage(true)
    try {
      const chat = useChatStore.getState()

      if (selectedTab === 1) {
        // AI analyses requirement and returns structured 4-section text
        await chat.sendMessage(buildRequirementIdentifyMessage(task, t))
        const reply = await waitForAssistantReply(task.conversationId)
        if (reply?.trim()) {
          useTaskStore.getState().updateTaskRequirementAnalysis(task.id, reply.trim())
        }
        // Stay on Tab1 so the user can review the generated analysis before proceeding

      } else if (selectedTab === 2) {
        // AI generates subtask breakdown
        await chat.sendMessage(buildTaskBreakdownExecuteMessage(t))
        const reply = await waitForAssistantReply(task.conversationId)
        if (reply) {
          const generated = extractSubtasks(reply)
          if (generated.length > 0) {
            updateTaskPipelineState(task.id, {
              pipelineSubtasks: generated,
              stage: Math.max(stage, 2) as PipelineStage,
            })
          }
        }
        setSelectedTab(2)

      } else if (selectedTab === 3) {
        // AI generates dev plan
        await chat.sendMessage(buildDevPlanExecuteMessage(t))
        const reply = await waitForAssistantReply(task.conversationId)
        if (reply) {
          updateTaskPipelineState(task.id, {
            pipelineDevPlan: reply.trim(),
            stage: Math.max(stage, 3) as PipelineStage,
          })
        }
        setSelectedTab(3)

      } else if (selectedTab === 4) {
        // Advance stage and send coding kickoff message with the dev plan
        updateTaskPipelineState(task.id, { stage: Math.max(stage, 4) as PipelineStage, pipelineResumeHint: t('正在编写代码') })
        await chat.sendMessage(buildCodingKickoffMessage(task, t))

      } else if (selectedTab === 5) {
        updateTaskPipelineState(task.id, { stage: 5, pipelineResumeHint: t('等待验收') })
      }
    } finally {
      setIsSendingMessage(false)
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
          <div className="overflow-y-auto px-3 pt-1 pb-3" style={{ height: contentHeight }}>
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
                onEdit={handleEditSubtask}
                onAdd={handleAddSubtask}
                onRemove={handleRemoveSubtask}
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

              <button
                type="button"
                onClick={() => void handleIdentifyIntent()}
                disabled={isIdentifying || isSendingMessage}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors border border-border hover:bg-secondary text-foreground disabled:opacity-50"
              >
                {isIdentifying
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : <ScanText className="w-3 h-3 opacity-70" />
                }
                {t('意图识别')}
              </button>

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

          {/* Resize handle */}
          <div
            onMouseDown={handleResizeMouseDown}
            className="h-3 cursor-ns-resize flex items-center justify-center group select-none border-t border-border/30 hover:border-border/60 transition-colors"
            aria-hidden="true"
          >
            <div className="w-10 h-0.5 rounded-full bg-border/50 group-hover:bg-muted-foreground/40 transition-colors" />
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
