/**
 * Inline pipeline panel shown above ChatView when in task-focus mode.
 *
 * Stage bar doubles as a tab navigator — clicking any stage switches
 * the body to show that stage's content regardless of current progress.
 *
 * Stages: 1=需求识别  2=任务拆解  3=开发计划  4=编码实现  5=用例验证
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
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
  X,
  GitBranch,
  Eye,
  Activity,
  ShieldCheck,
  ScrollText,
  Layers,
} from 'lucide-react'
import { MarkdownRenderer } from '../chat/MarkdownRenderer'
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
  buildVerificationExecuteMessage,
  evaluateCodingPrereqs,
  assertPreviousPipelineStepReady,
  getInvolvedProjectDirNames,
  buildProjectDisplayPaths,
  getSubtaskProgressStats,
} from '../../lib/workspace-task-messages'
import type { PipelineStage, PipelineSubtask, PipelineSubtaskStatus, WorkspaceTask, FileChangesSummary } from '../../types'
import { api } from '../../api'

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
function pickFocusSubtask(list: PipelineSubtask[]): PipelineSubtask | null {
  if (!list.length) return null
  return (
    list.find((s) => s.status === 'pending') ??
    list.find((s) => s.status === 'in_progress') ??
    list[0] ??
    null
  )
}

function extractSubtasks(text: string): PipelineSubtask[] {
  const now = Date.now()
  const result: PipelineSubtask[] = []
  let currentGroup = ''
  let idx = 0
  for (const line of text.split('\n')) {
    // Detect ## group heading
    const groupMatch = line.match(/^#{1,3}\s+(.+)/)
    if (groupMatch) {
      currentGroup = groupMatch[1].trim()
      continue
    }
    // Detect bullet item
    if (/^\s*[-•*]\s+.+/.test(line)) {
      const raw = line.trim().replace(/^[-•*]\s+/, '').trim()
      const colonIdx = raw.search(/[:：]/)
      const rawTitle = colonIdx > 0 ? raw.slice(0, colonIdx).trim() : raw
      const description = colonIdx > 0 ? raw.slice(colonIdx + 1).trim() : ''
      // Extract "(proj1, proj2)" from the end of the title
      const projMatch = rawTitle.match(/^(.*?)\s*\(([^)]+)\)\s*$/)
      const title = projMatch ? projMatch[1].trim() : rawTitle
      const projects = projMatch
        ? projMatch[2].split(',').map((p) => p.trim()).filter(Boolean)
        : undefined
      if (title.length > 0 && title.length < 200) {
        result.push({
          id: `st-${now}-${idx++}`,
          title,
          description,
          status: 'pending' as PipelineSubtaskStatus,
          group: currentGroup || undefined,
          projects: projects?.length ? projects : undefined,
        })
      }
    }
  }
  return result
}

/** Extract per-project changes and overall scope from the AI dev plan reply. */
function parseDevPlanReply(reply: string): { projectChanges: string; scopeText: string } {
  const projectChangesMarker = /^#{1,2}\s*(各项目改动点|Per.project Changes?)/im
  const scopeMarker = /^#{1,2}\s*(整体改动说明|Overall.*|Code.*Scope|代码改动)/im
  const lines = reply.split('\n')
  let inProjectChanges = false
  let inScope = false
  const projectLines: string[] = []
  const scopeLines: string[] = []
  for (const line of lines) {
    if (projectChangesMarker.test(line)) { inProjectChanges = true; inScope = false; continue }
    if (scopeMarker.test(line)) { inScope = true; inProjectChanges = false; continue }
    if (inProjectChanges) projectLines.push(line)
    else if (inScope) scopeLines.push(line)
  }
  const projectChanges = projectLines.join('\n').trim()
  const scopeText = scopeLines.join('\n').trim()
  // If the AI didn't use the expected structure, treat the whole reply as scope
  if (!projectChanges && !scopeText) return { projectChanges: '', scopeText: reply.trim() }
  return { projectChanges, scopeText }
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

const STAGES: { id: PipelineStage; label: string; activeColor: string; mutedColor: string; selectedBg: string }[] = [
  { id: 1, label: '需求识别', activeColor: 'text-violet-500',  mutedColor: 'text-violet-400/30',  selectedBg: 'bg-violet-500/15'  },
  { id: 2, label: '任务拆解', activeColor: 'text-blue-500',    mutedColor: 'text-blue-400/30',    selectedBg: 'bg-blue-500/15'    },
  { id: 3, label: '开发计划', activeColor: 'text-emerald-500', mutedColor: 'text-emerald-400/30', selectedBg: 'bg-emerald-500/15' },
  { id: 4, label: '编码实现', activeColor: 'text-orange-500',  mutedColor: 'text-orange-400/30',  selectedBg: 'bg-orange-500/15'  },
  { id: 5, label: '用例验证', activeColor: 'text-pink-500',    mutedColor: 'text-pink-400/30',    selectedBg: 'bg-pink-500/15'    },
]

// ─────────────────────────────────────────────
// StageTabBar — progress indicator + tab clicks
// ─────────────────────────────────────────────

function StageTabBar({
  stage,
  selectedTab,
  visibleStages,
  onSelect,
}: {
  stage: PipelineStage
  selectedTab: PipelineStage
  visibleStages?: readonly PipelineStage[]
  onSelect: (id: PipelineStage) => void
}) {
  const displayStages = visibleStages ? STAGES.filter((s) => visibleStages.includes(s.id)) : STAGES
  return (
    <div className="flex items-center gap-0 flex-1 min-w-0">
      {displayStages.map((s, i) => {
        const isDone = s.id < stage
        const isCurrent = s.id === stage
        const isSelected = s.id === selectedTab
        const textColor = (isDone || isCurrent) ? s.activeColor : s.mutedColor

        return (
          <div key={s.id} className="flex items-center flex-1 min-w-0">
            <button
              type="button"
              onClick={() => onSelect(s.id)}
              className={`
                flex items-center gap-1 px-1.5 py-1 rounded text-[11px] font-medium
                flex-1 justify-center min-w-0 transition-colors
                ${isSelected ? s.selectedBg : 'hover:bg-secondary/60'}
                ${textColor}
              `}
            >
              {isDone ? (
                <CheckCircle2 className="w-3 h-3 flex-shrink-0" />
              ) : isCurrent ? (
                <Circle className="w-3 h-3 flex-shrink-0 stroke-current" />
              ) : (
                <Circle className="w-3 h-3 flex-shrink-0" />
              )}
              <span className="hidden sm:inline truncate">{s.label}</span>
            </button>
            {i < displayStages.length - 1 && (
              <div className={`h-px w-2 flex-shrink-0 ${s.id < stage ? 'bg-border/60' : 'bg-border'}`} />
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
        {subtask.projects && subtask.projects.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {subtask.projects.map((proj) => (
              <span
                key={proj}
                className="inline-flex items-center px-1.5 py-0 rounded text-[10px] bg-secondary text-muted-foreground font-mono leading-5"
              >
                {proj}
              </span>
            ))}
          </div>
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
      {onRemove && (
        <button
          type="button"
          onClick={() => onRemove(subtask.id)}
          className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
          aria-label={t('Delete')}
        >
          <X className="w-3 h-3" />
        </button>
      )}
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
  isSimple,
  onBreakdown,
}: {
  task: WorkspaceTask
  stage: PipelineStage
  isSimple?: boolean
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
  const [analysisEditing, setAnalysisEditing] = useState(false)

  // Sync description draft when task updates externally
  useEffect(() => {
    const incoming = task.requirementDescription ?? ''
    if (incoming !== savedDescRef.current) {
      savedDescRef.current = incoming
      setDescDraft(incoming)
    }
  }, [task.requirementDescription])

  const descTextareaRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = descTextareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [descDraft])

  const analysisTextareaRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = analysisTextareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [analysisDraft])

  // Sync analysis draft when task updates externally (e.g. after AI writes it)
  // Auto-switch to preview when AI fills in fresh content
  useEffect(() => {
    const incoming = task.requirementAnalysis ?? ''
    if (incoming !== savedAnalysisRef.current) {
      savedAnalysisRef.current = incoming
      setAnalysisDraft(incoming)
      if (incoming.trim()) setAnalysisEditing(false)
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
          ref={descTextareaRef}
          className="w-full min-h-[6rem] text-xs bg-secondary/40 border border-border rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50 leading-relaxed overflow-hidden"
          rows={1}
          placeholder={t('描述需求，或通过上传文档补充...')}
          value={descDraft}
          onChange={(e) => setDescDraft(e.target.value)}
          onBlur={handleDescBlur}
        />
      </div>

      {/* Requirement analysis — full structured AI output, preview/edit toggle */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('需求分析')}</p>
          {analysisDraft ? (
            <button
              type="button"
              onClick={() => setAnalysisEditing((v) => !v)}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              {analysisEditing
                ? <><Eye className="w-3 h-3" />{t('预览')}</>
                : <><Pencil className="w-3 h-3" />{t('编辑')}</>
              }
            </button>
          ) : null}
        </div>
        {analysisDraft ? (
          analysisEditing ? (
            <textarea
              ref={analysisTextareaRef}
              className="w-full min-h-[6rem] text-xs bg-secondary/40 border border-border rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-ring leading-relaxed font-[inherit] overflow-hidden"
              rows={1}
              value={analysisDraft}
              onChange={(e) => setAnalysisDraft(e.target.value)}
              onBlur={() => { handleAnalysisBlur(); setAnalysisEditing(false) }}
            />
          ) : (
            <div
              className="text-xs bg-secondary/40 border border-border rounded-lg px-2.5 py-2 cursor-pointer hover:bg-secondary/60 transition-colors prose prose-sm dark:prose-invert max-w-none"
              onClick={() => setAnalysisEditing(true)}
            >
              <MarkdownRenderer content={analysisDraft} mode="static" />
            </div>
          )
        ) : (
          <p className="text-[11px] text-muted-foreground/50 italic px-0.5">
            {t('Click "Start" to let AI analyse the requirement and fill this section')}
          </p>
        )}
      </div>

      {/* Breakdown trigger — stage 1 only, hidden for simple tasks */}
      {stage === 1 && !isSimple && (
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

  // Group subtasks by their group field, preserving insertion order
  const groupEntries: [string, PipelineSubtask[]][] = []
  const groupMap = new Map<string, PipelineSubtask[]>()
  for (const st of subtasks) {
    const key = st.group ?? ''
    if (!groupMap.has(key)) {
      const bucket: PipelineSubtask[] = []
      groupMap.set(key, bucket)
      groupEntries.push([key, bucket])
    }
    groupMap.get(key)!.push(st)
  }
  const hasGroups = groupEntries.some(([key]) => key !== '')

  return (
    <div className="space-y-3">
      {groupEntries.map(([groupName, groupTasks]) => (
        <div key={groupName || '__ungrouped'}>
          {hasGroups && groupName && (
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-0.5 pb-1 mb-0.5 border-b border-border/40">
              {groupName}
            </div>
          )}
          <div className="space-y-0.5">
            {groupTasks.map((st) => (
              <SubtaskItem key={st.id} subtask={st} onToggle={onToggle} onEdit={onEdit} onRemove={onRemove} />
            ))}
          </div>
        </div>
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
  workspaceRoot,
  onSaveDevPlan,
  onSaveBranchName,
  onAddProject,
  onRemoveProject,
}: {
  task: WorkspaceTask
  workspaceRoot: string | null
  onSaveDevPlan: (text: string) => void
  onSaveBranchName: (branch: string) => void
  onAddProject: (dir: string) => void
  onRemoveProject: (dir: string) => void
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(task.pipelineDevPlan ?? '')
  const savedRef = useRef(task.pipelineDevPlan ?? '')
  const [devPlanEditing, setDevPlanEditing] = useState(false)
  const [branchDraft, setBranchDraft] = useState(task.branchName ?? '')
  const savedBranchRef = useRef(task.branchName ?? '')
  const [availableRoots, setAvailableRoots] = useState<string[]>([])
  // Collapsed by default; expand button shows non-added projects; never re-collapses on X click.
  // Component remounts on tab switch, so this resets to false each time Tab3 is opened.
  const [showAllRoots, setShowAllRoots] = useState(false)

  // Fetch workspace root folder names for the project picker
  useEffect(() => {
    let cancelled = false
    api.listArtifactsTree(task.spaceId).then((res) => {
      if (cancelled || !res.success || !res.data) return
      const nodes = (res.data as { nodes: { name: string }[] }).nodes ?? []
      setAvailableRoots(nodes.map((n) => n.name).filter(Boolean))
    }).catch(() => {/* ignore */})
    return () => { cancelled = true }
  }, [task.spaceId])

  // Sync when task changes externally; auto-switch to preview when AI fills it
  useEffect(() => {
    const incoming = task.pipelineDevPlan ?? ''
    if (incoming !== savedRef.current) {
      savedRef.current = incoming
      setDraft(incoming)
      if (incoming.trim()) setDevPlanEditing(false)
    }
  }, [task.pipelineDevPlan])

  useEffect(() => {
    const incoming = task.branchName ?? ''
    if (incoming !== savedBranchRef.current) {
      savedBranchRef.current = incoming
      setBranchDraft(incoming)
    }
  }, [task.branchName])

  const handleBlur = useCallback(() => {
    if (draft !== savedRef.current) {
      savedRef.current = draft
      onSaveDevPlan(draft)
    }
  }, [draft, onSaveDevPlan])

  const handleBranchBlur = useCallback(() => {
    const trimmed = branchDraft.trim()
    if (trimmed !== savedBranchRef.current) {
      savedBranchRef.current = trimmed
      setBranchDraft(trimmed)
      onSaveBranchName(trimmed)
    }
  }, [branchDraft, onSaveBranchName])

  const devPlanTextareaRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = devPlanTextareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [draft])

  // Merge available roots with already-added project dirs (in case workspace hasn't loaded yet)
  const projectDirsSet = new Set(task.projectDirs)
  const allRootsToShow = availableRoots.length > 0
    ? Array.from(new Set([...availableRoots, ...task.projectDirs]))
    : task.projectDirs

  const notAddedCount = allRootsToShow.filter((n) => !projectDirsSet.has(n)).length

  return (
    <div className="space-y-3">
      {/* 涉及项目 */}
      <div>
        <div className="flex items-center gap-1 mb-1.5">
          <FolderOpen className="w-3 h-3 text-muted-foreground/70 flex-shrink-0" />
          <span className="text-[11px] text-muted-foreground">{t('涉及项目')}</span>
        </div>
        {allRootsToShow.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {allRootsToShow.map((name) => {
              const added = projectDirsSet.has(name)
              // When collapsed, hide non-added projects
              if (!added && !showAllRoots) return null
              return added ? (
                <span
                  key={name}
                  className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md bg-primary/15 border border-primary/30 text-[11px] text-foreground/90 font-mono"
                >
                  {name}
                  <button
                    type="button"
                    onClick={() => onRemoveProject(name)}
                    className="flex items-center justify-center w-3.5 h-3.5 rounded hover:bg-destructive/20 hover:text-destructive transition-colors text-muted-foreground"
                    title={t('从任务中移除')}
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ) : (
                <button
                  key={name}
                  type="button"
                  onClick={() => onAddProject(name)}
                  className="inline-flex items-center gap-1 pl-2 pr-1.5 py-0.5 rounded-md bg-secondary border border-border text-[11px] text-muted-foreground font-mono hover:bg-secondary/80 hover:text-foreground transition-colors"
                  title={t('添加到任务中')}
                >
                  {name}
                  <Plus className="w-2.5 h-2.5" />
                </button>
              )
            })}
            {/* Toggle button for non-added projects */}
            {notAddedCount > 0 && (
              <button
                type="button"
                onClick={() => setShowAllRoots((v) => !v)}
                className="inline-flex items-center gap-1 pl-2 pr-1.5 py-0.5 rounded-md border border-dashed border-border text-[11px] text-muted-foreground hover:text-foreground hover:border-border/80 transition-colors"
              >
                {showAllRoots
                  ? <><ChevronUp className="w-2.5 h-2.5" />{t('收起')}</>
                  : <><ChevronDown className="w-2.5 h-2.5" />{t('+{{n}} 个项目', { n: notAddedCount })}</>
                }
              </button>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground/50 italic">{t('暂无项目，AI 识别需求后自动填入')}</p>
        )}
      </div>

      {/* 开发分支 */}
      <div>
        <div className="flex items-center gap-1 mb-1.5">
          <GitBranch className="w-3 h-3 text-muted-foreground/70 flex-shrink-0" />
          <span className="text-[11px] text-muted-foreground">{t('开发分支')}</span>
        </div>
        <input
          type="text"
          className="w-full text-xs bg-secondary/40 border border-border rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50 font-mono"
          placeholder={t('e.g. feature/your-branch')}
          value={branchDraft}
          onChange={(e) => setBranchDraft(e.target.value)}
          onBlur={handleBranchBlur}
        />
      </div>

      {/* 代码改动范围 */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1">
            <Code2 className="w-3 h-3 text-muted-foreground/70 flex-shrink-0" />
            <span className="text-[11px] text-muted-foreground">{t('代码改动范围')}</span>
          </div>
          {draft ? (
            <button
              type="button"
              onClick={() => setDevPlanEditing((v) => !v)}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              {devPlanEditing
                ? <><Eye className="w-3 h-3" />{t('预览')}</>
                : <><Pencil className="w-3 h-3" />{t('编辑')}</>
              }
            </button>
          ) : null}
        </div>
        {draft ? (
          devPlanEditing ? (
            <textarea
              ref={devPlanTextareaRef}
              className="w-full min-h-[4rem] text-xs bg-secondary/40 border border-border rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50 leading-relaxed"
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => { handleBlur(); setDevPlanEditing(false) }}
            />
          ) : (
            <div
              className="text-xs bg-secondary/40 border border-border rounded-lg px-2.5 py-2 cursor-pointer hover:bg-secondary/60 transition-colors prose prose-sm dark:prose-invert max-w-none"
              onClick={() => setDevPlanEditing(true)}
            >
              <MarkdownRenderer content={draft} mode="static" />
            </div>
          )
        ) : (
          <textarea
            ref={devPlanTextareaRef}
            className="w-full min-h-[4rem] text-xs bg-secondary/40 border border-border rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50 leading-relaxed"
            rows={1}
            placeholder={t('描述要改哪些模块、文件或接口，AI 会帮你填写...')}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={handleBlur}
          />
        )}
      </div>

      {/* 各项目改动点 */}
      {task.pipelineProjectChanges && (
        <div>
          <div className="flex items-center gap-1 mb-1.5">
            <Layers className="w-3 h-3 text-muted-foreground/70 flex-shrink-0" />
            <span className="text-[11px] text-muted-foreground">{t('各项目改动点')}</span>
          </div>
          <div className="text-xs bg-secondary/40 border border-border rounded-lg px-2.5 py-2 prose prose-sm dark:prose-invert max-w-none">
            <MarkdownRenderer content={task.pipelineProjectChanges} mode="static" />
          </div>
        </div>
      )}
    </div>
  )
}

/** Tab 4 — 编码实现：依赖开发计划、涉及项目与分支；展示活动记录 */
function Tab4Coding({
  task,
  workspaceRoot,
  subtasks,
}: {
  task: WorkspaceTask
  workspaceRoot: string | null
  subtasks: PipelineSubtask[]
}) {
  const { t } = useTranslation()

  // Fetch workspace roots on each mount (each tab switch remounts this component)
  // to get accurate absolute paths and reflect any changes made in the dev plan tab.
  const [resolvedRoot, setResolvedRoot] = useState<string | null>(null)
  const [availableRootNames, setAvailableRootNames] = useState<string[] | null>(null)

  useEffect(() => {
    let cancelled = false
    api.listArtifactsTree(task.spaceId).then((res) => {
      if (cancelled || !res.success || !res.data) return
      const data = res.data as { workspaceRoot: string; nodes: { name: string }[] }
      setResolvedRoot(data.workspaceRoot || null)
      setAvailableRootNames(data.nodes?.map((n) => n.name).filter(Boolean) ?? [])
    }).catch(() => {/* ignore */})
    return () => { cancelled = true }
  }, [task.spaceId])

  const isSimple = task.taskType === 'simple'

  // For simple tasks: editable project picker + branch directly in Tab4
  const addProjectDirToTask = useTaskStore((s) => s.addProjectDirToTask)
  const removeProjectDirFromTask = useTaskStore((s) => s.removeProjectDirFromTask)
  const updateTaskBranchName = useTaskStore((s) => s.updateTaskBranchName)
  const [branchDraft, setBranchDraft] = useState(task.branchName ?? '')
  const savedBranchRef = useRef(task.branchName ?? '')
  const [showAllRoots, setShowAllRoots] = useState(false)
  useEffect(() => {
    const incoming = task.branchName ?? ''
    if (incoming !== savedBranchRef.current) {
      savedBranchRef.current = incoming
      setBranchDraft(incoming)
    }
  }, [task.branchName])
  const handleBranchBlur = useCallback(() => {
    const trimmed = branchDraft.trim()
    if (trimmed !== savedBranchRef.current) {
      savedBranchRef.current = trimmed
      setBranchDraft(trimmed)
      updateTaskBranchName(task.id, trimmed)
    }
  }, [branchDraft, updateTaskBranchName, task.id])

  // Use the API-resolved root when available; fall back to the prop from spaceStore
  const effectiveRoot = resolvedRoot ?? workspaceRoot
  const dirs = task.projectDirs.filter(Boolean)
  const paths = effectiveRoot ? buildProjectDisplayPaths(effectiveRoot, dirs) : dirs
  const projectDirsSet = new Set(dirs)
  const allRootsToShow = availableRootNames && availableRootNames.length > 0
    ? Array.from(new Set([...availableRootNames, ...dirs]))
    : dirs
  const notAddedCount = allRootsToShow.filter((n) => !projectDirsSet.has(n)).length
  const prereq = evaluateCodingPrereqs(task, t)
  const logLines = task.pipelineCodingLogLines ?? []
  const planExcerptDisplay = useMemo(() => {
    const raw = (task.pipelineDevPlan ?? '').trim()
    const head = raw.slice(0, 1200)
    const tail = raw.length > 1200 ? `\n…\n${t('(truncated)')}` : ''
    return head + tail
  }, [task.pipelineDevPlan, t])


  const progress = getSubtaskProgressStats(subtasks)

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center gap-1 mb-1">
          <ClipboardList className="w-3 h-3 text-muted-foreground/70 flex-shrink-0" />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('子任务进度')}</span>
        </div>
        {progress.total === 0 ? (
          <p className="text-[11px] text-muted-foreground/80 leading-snug">
            {task.taskType === 'simple'
              ? t('当前暂无子任务记录，开始工作将依据需求分析进行编码。')
              : t(
                  '当前暂无子任务记录。意图识别 / 开始工作将仅依据开发计划进行比对；请在标签 2 添加子任务以跟踪完成情况。'
                )}
          </p>
        ) : (
          <div className="space-y-1.5">
            <p className="text-[11px] text-foreground/90">
              {t('{{done}} / {{total}} subtasks marked done', { done: progress.doneCount, total: progress.total })}
            </p>
            {progress.allDone ? (
              <p className="text-[11px] text-emerald-700 dark:text-emerald-300/90 leading-snug">
                {t('所有子任务均已完成。可先执行意图识别，确认开发计划中没有遗漏。')}
              </p>
            ) : progress.nextSubtask ? (
              <p className="text-[11px] text-foreground/85 leading-snug">
                {t('建议下一个关注点：{{title}}', { title: progress.nextSubtask.title })}
              </p>
            ) : null}
            <p className="text-[10px] text-muted-foreground/75 leading-snug">
              {t('意图识别与开始工作消息会附带该进度，便于模型判断剩余工作。')}
            </p>
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center gap-1 mb-1">
          <ShieldCheck className="w-3 h-3 text-muted-foreground/70 flex-shrink-0" />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('编码前置条件')}</span>
        </div>
        {!prereq.ok ? (
          <p className="text-[11px] text-amber-700 dark:text-amber-300/90 leading-snug">{prereq.message}</p>
        ) : (
          <p className="text-[11px] text-emerald-700 dark:text-emerald-300/90 leading-snug">
            {task.taskType === 'simple'
              ? t('需求分析已就绪，可以直接开始编码。')
              : t('开发计划、涉及项目和开发分支已就绪。请先执行意图识别，再开始工作。')}
          </p>
        )}
      </div>

      <div>
        <div className="flex items-center gap-1 mb-1">
          <FolderOpen className="w-3 h-3 text-muted-foreground/70 flex-shrink-0" />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('涉及项目路径')}</span>
          {availableRootNames === null && (
            <Loader2 className="w-3 h-3 text-muted-foreground/60 animate-spin ml-1" />
          )}
        </div>
        {isSimple ? (
          allRootsToShow.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {allRootsToShow.map((name) => {
                const added = projectDirsSet.has(name)
                if (!added && !showAllRoots) return null
                return added ? (
                  <span key={name} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md bg-primary/15 border border-primary/30 text-[11px] text-foreground/90 font-mono">
                    {name}
                    <button type="button" onClick={() => removeProjectDirFromTask(task.id, name)}
                      className="flex items-center justify-center w-3.5 h-3.5 rounded hover:bg-destructive/20 hover:text-destructive transition-colors text-muted-foreground"
                      title={t('从任务中移除')}>
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ) : (
                  <button key={name} type="button" onClick={() => addProjectDirToTask(task.id, name)}
                    className="inline-flex items-center gap-1 pl-2 pr-1.5 py-0.5 rounded-md bg-secondary border border-border text-[11px] text-muted-foreground font-mono hover:bg-secondary/80 hover:text-foreground transition-colors"
                    title={t('添加到任务中')}>
                    {name}
                    <Plus className="w-2.5 h-2.5" />
                  </button>
                )
              })}
              {notAddedCount > 0 && (
                <button type="button" onClick={() => setShowAllRoots((v) => !v)}
                  className="inline-flex items-center gap-1 pl-2 pr-1.5 py-0.5 rounded-md border border-dashed border-border text-[11px] text-muted-foreground hover:text-foreground hover:border-border/80 transition-colors">
                  {showAllRoots
                    ? <><ChevronUp className="w-2.5 h-2.5" />{t('收起')}</>
                    : <><ChevronDown className="w-2.5 h-2.5" />{t('+{{n}} 个项目', { n: notAddedCount })}</>}
                </button>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground/50 italic">{t('暂无项目，AI 识别需求后自动填入')}</p>
          )
        ) : (
          <>
            {paths.length > 0 ? (
              <ul className="text-[11px] font-mono text-foreground/85 space-y-0.5 break-all">
                {paths.map((p) => (
                  <li key={p}>- {p}</li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-muted-foreground/60 italic">{t('尚未关联项目')}</p>
            )}
            {!effectiveRoot && dirs.length > 0 && (
              <p className="text-[10px] text-muted-foreground/70 mt-1">{t('工作区路径不可用，仅显示目录名称。')}</p>
            )}
          </>
        )}
      </div>

      <div>
        <div className="flex items-center gap-1 mb-1">
          <GitBranch className="w-3 h-3 text-muted-foreground/70 flex-shrink-0" />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('开发分支')}</span>
        </div>
        {isSimple ? (
          <input
            type="text"
            className="w-full text-xs bg-secondary/40 border border-border rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50 font-mono"
            placeholder={t('e.g. feature/your-branch')}
            value={branchDraft}
            onChange={(e) => setBranchDraft(e.target.value)}
            onBlur={handleBranchBlur}
          />
        ) : (
          <p className="text-xs font-mono text-foreground/90 break-all">
            {task.branchName?.trim() ? task.branchName.trim() : t('未设置')}
          </p>
        )}
      </div>

      <div>
        <div className="flex items-center gap-1 mb-1">
          <ScrollText className="w-3 h-3 text-muted-foreground/70 flex-shrink-0" />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('开发计划摘录')}</span>
        </div>
        {planExcerptDisplay ? (
          <div className="text-xs bg-secondary/30 border border-border/60 rounded-lg px-2.5 py-2 prose prose-sm dark:prose-invert max-w-none">
            <MarkdownRenderer content={planExcerptDisplay} mode="static" />
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground/60 italic">{t('暂无开发计划文本')}</p>
        )}
      </div>

      <div>
        <div className="flex items-center gap-1 mb-1">
          <Activity className="w-3 h-3 text-muted-foreground/70 flex-shrink-0" />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('编码活动日志')}</span>
        </div>
        {logLines.length === 0 ? (
          <p className="text-[11px] text-muted-foreground/60 italic">
            {t('点击开始工作后，会在此记录一条日志（子任务与项目）。')}
          </p>
        ) : (
          <ul className="text-[11px] text-foreground/85 space-y-1 max-h-36 overflow-y-auto border border-border/50 rounded-lg px-2 py-2 bg-secondary/20">
            {logLines.map((line, i) => (
              <li key={`${i}-${line.slice(0, 24)}`} className="leading-snug break-words">
                {line}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground/70 leading-snug">
        {t('意图识别会让模型对照开发计划与已完成子任务，并给出下一步；开始工作会携带相同上下文发送编码消息。')}
      </p>
    </div>
  )
}

/** Tab 5 — 用例验证：依赖检查命令 + 编译检查命令 */
function Tab5Review({
  task,
  onSaveDepCheckCmd,
  onSaveBuildCheckCmd,
  onSaveApiTestCmd,
}: {
  task: WorkspaceTask
  onSaveDepCheckCmd: (cmd: string) => void
  onSaveBuildCheckCmd: (cmd: string) => void
  onSaveApiTestCmd: (cmd: string) => void
}) {
  const { t } = useTranslation()
  const [depDraft, setDepDraft] = useState(task.pipelineDepCheckCmd ?? '')
  const savedDepRef = useRef(task.pipelineDepCheckCmd ?? '')
  const [buildDraft, setBuildDraft] = useState(task.pipelineBuildCheckCmd ?? '')
  const savedBuildRef = useRef(task.pipelineBuildCheckCmd ?? '')
  const [apiDraft, setApiDraft] = useState(task.pipelineApiTestCmd ?? '')
  const savedApiRef = useRef(task.pipelineApiTestCmd ?? '')

  // Sync when task updates externally
  useEffect(() => {
    const incoming = task.pipelineDepCheckCmd ?? ''
    if (incoming !== savedDepRef.current) {
      savedDepRef.current = incoming
      setDepDraft(incoming)
    }
  }, [task.pipelineDepCheckCmd])

  useEffect(() => {
    const incoming = task.pipelineBuildCheckCmd ?? ''
    if (incoming !== savedBuildRef.current) {
      savedBuildRef.current = incoming
      setBuildDraft(incoming)
    }
  }, [task.pipelineBuildCheckCmd])

  useEffect(() => {
    const incoming = task.pipelineApiTestCmd ?? ''
    if (incoming !== savedApiRef.current) {
      savedApiRef.current = incoming
      setApiDraft(incoming)
    }
  }, [task.pipelineApiTestCmd])

  const handleDepBlur = useCallback(() => {
    const trimmed = depDraft.trim()
    if (trimmed !== savedDepRef.current) {
      savedDepRef.current = trimmed
      onSaveDepCheckCmd(trimmed)
    }
  }, [depDraft, onSaveDepCheckCmd])

  const handleBuildBlur = useCallback(() => {
    const trimmed = buildDraft.trim()
    if (trimmed !== savedBuildRef.current) {
      savedBuildRef.current = trimmed
      onSaveBuildCheckCmd(trimmed)
    }
  }, [buildDraft, onSaveBuildCheckCmd])

  const handleApiBlur = useCallback(() => {
    const trimmed = apiDraft.trim()
    if (trimmed !== savedApiRef.current) {
      savedApiRef.current = trimmed
      onSaveApiTestCmd(trimmed)
    }
  }, [apiDraft, onSaveApiTestCmd])

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground/80 leading-snug">
        {t('点击开始工作，AI 将依次执行语法检查、依赖检查（可选）、编译检查（可选）、接口用例验证（可选），并汇报每步结果。')}
      </p>

      {/* 依赖检查命令 */}
      <div>
        <div className="flex items-center gap-1 mb-1.5">
          <ShieldCheck className="w-3 h-3 text-muted-foreground/70 flex-shrink-0" />
          <span className="text-[11px] text-muted-foreground">{t('依赖检查命令')}</span>
          <span className="text-[10px] text-muted-foreground/50 ml-1">{t('（可选）')}</span>
        </div>
        <input
          type="text"
          className="w-full text-xs bg-secondary/40 border border-border rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50 font-mono"
          placeholder="e.g. go mod tidy"
          value={depDraft}
          onChange={(e) => setDepDraft(e.target.value)}
          onBlur={handleDepBlur}
        />
      </div>

      {/* 编译检查命令 */}
      <div>
        <div className="flex items-center gap-1 mb-1.5">
          <Code2 className="w-3 h-3 text-muted-foreground/70 flex-shrink-0" />
          <span className="text-[11px] text-muted-foreground">{t('编译检查命令')}</span>
          <span className="text-[10px] text-muted-foreground/50 ml-1">{t('（可选）')}</span>
        </div>
        <input
          type="text"
          className="w-full text-xs bg-secondary/40 border border-border rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50 font-mono"
          placeholder="e.g. make"
          value={buildDraft}
          onChange={(e) => setBuildDraft(e.target.value)}
          onBlur={handleBuildBlur}
        />
      </div>

      {/* 接口用例验证命令 */}
      <div>
        <div className="flex items-center gap-1 mb-1.5">
          <Activity className="w-3 h-3 text-muted-foreground/70 flex-shrink-0" />
          <span className="text-[11px] text-muted-foreground">{t('接口用例验证')}</span>
          <span className="text-[10px] text-muted-foreground/50 ml-1">{t('（可选）')}</span>
        </div>
        <textarea
          className="w-full text-xs bg-secondary/40 border border-border rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50 font-mono resize-none"
          placeholder={'e.g. curl -X POST http://localhost:8080/api/xxx \\\n  -H \'Content-Type: application/json\' \\\n  -d \'{"key":"value"}\''}
          rows={3}
          value={apiDraft}
          onChange={(e) => setApiDraft(e.target.value)}
          onBlur={handleApiBlur}
        />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// Session report
// ─────────────────────────────────────────────

interface SessionReport {
  durationMs: number
  inputTokens: number
  outputTokens: number
  fileChanges?: FileChangesSummary
  stage: PipelineStage
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}秒`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem > 0 ? `${m}分${rem}秒` : `${m}分钟`
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

/** Build structured task context text for KB writer agent */
function buildTaskContextForKb(task: WorkspaceTask): string {
  const lines: string[] = [`任务名称：${task.name}`]

  if (task.requirementAnalysis?.trim()) {
    lines.push('', '需求分析：', task.requirementAnalysis.trim().slice(0, 1000))
  } else if (task.requirementKeyPoints?.length) {
    lines.push('', '需求要点：')
    task.requirementKeyPoints.forEach(p => lines.push(`- ${p}`))
  }

  if (task.pipelineSubtasks?.length) {
    lines.push('', '子任务：')
    task.pipelineSubtasks.forEach(st =>
      lines.push(`- [${st.status}] ${st.title}${st.description ? '：' + st.description : ''}`)
    )
  }

  if (task.pipelineDevPlan?.trim()) {
    lines.push('', '开发计划：', task.pipelineDevPlan.trim().slice(0, 1200))
  }

  if (task.projectDirs?.length) {
    lines.push('', `涉及项目：${task.projectDirs.join('、')}`)
  }

  return lines.join('\n')
}

function SessionReportCard({ report }: { report: SessionReport }) {
  const { t } = useTranslation()
  const showCodeStats = (report.stage === 4 || report.stage === 5) && report.fileChanges

  return (
    <div className="mx-3 mb-2 rounded-lg border border-border/50 bg-secondary/40 px-3 py-2 text-[11px] text-foreground/80 space-y-1.5">
      {/* Row 1: duration + tokens */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="flex items-center gap-1">
          <span className="text-muted-foreground">{t('耗时')}</span>
          <span className="font-medium tabular-nums">{formatDuration(report.durationMs)}</span>
        </span>
        <span className="text-border/80">|</span>
        <span className="flex items-center gap-1">
          <span className="text-muted-foreground">{t('输入')}</span>
          <span className="font-medium tabular-nums text-blue-500/90">{formatTokens(report.inputTokens)}</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="text-muted-foreground">{t('输出')}</span>
          <span className="font-medium tabular-nums text-violet-500/90">{formatTokens(report.outputTokens)}</span>
        </span>
      </div>

      {/* Row 2: code change stats (stage 4 / 5 only) */}
      {showCodeStats && report.fileChanges && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="flex items-center gap-1">
            <span className="text-muted-foreground">{t('涉及文件')}</span>
            <span className="font-medium tabular-nums">{report.fileChanges.totalFiles}</span>
          </span>
          <span className="text-border/80">|</span>
          <span className="font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
            +{report.fileChanges.totalAdded}
          </span>
          <span className="font-medium tabular-nums text-red-500/90">
            -{report.fileChanges.totalRemoved}
          </span>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
// Main panel inner
// ─────────────────────────────────────────────

function TaskPipelinePanelInner({ task }: { task: WorkspaceTask }) {
  const { t } = useTranslation()
  const updateTaskPipelineState = useTaskStore((s) => s.updateTaskPipelineState)
  const updateTaskBranchName = useTaskStore((s) => s.updateTaskBranchName)
  const addProjectDirToTask = useTaskStore((s) => s.addProjectDirToTask)
  const removeProjectDirFromTask = useTaskStore((s) => s.removeProjectDirFromTask)

  const workspaceRoot = task.spacePath?.trim() || ''
  const workspaceRootForUi = workspaceRoot || null
  const knowledgeBaseRoot = task.kbRootPath?.trim() || null

  const stage: PipelineStage = task.pipelineStage ?? 1
  const subtasks: PipelineSubtask[] = task.pipelineSubtasks ?? []
  const resumeHint = task.pipelineResumeHint ?? ''
  const isSimple = task.taskType === 'simple'
  const visibleStageIds: readonly PipelineStage[] = isSimple ? [1, 4, 5] : [1, 2, 3, 4, 5]

  // selectedTab follows progress stage, but user can freely switch
  const [selectedTab, setSelectedTab] = useState<PipelineStage>(stage)
  const [collapsed, setCollapsed] = useState(false)
  const [checkResult, setCheckResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [isSendingMessage, setIsSendingMessage] = useState(false)
  const [isIdentifying, setIsIdentifying] = useState(false)
  const [sessionReport, setSessionReport] = useState<SessionReport | null>(null)

  // Refs for tracking session report
  const reportStartTimeRef = useRef<number | null>(null)
  const reportStageRef = useRef<PipelineStage>(1)
  const wasGeneratingRef = useRef(false)
  const selectedTabRef = useRef<PipelineStage>(selectedTab)
  useEffect(() => { selectedTabRef.current = selectedTab }, [selectedTab])

  // Refs for KB write trigger (avoid stale closures in store subscription)
  const knowledgeBaseRootRef = useRef(knowledgeBaseRoot)
  useEffect(() => { knowledgeBaseRootRef.current = knowledgeBaseRoot }, [knowledgeBaseRoot])
  const taskRef = useRef(task)
  useEffect(() => { taskRef.current = task }, [task])

  // Deferred pipeline action — set before fire-and-forget sendMessage calls (stages 1/2/3);
  // executed by the subscribe callback when generation ends.
  const pendingPipelineActionRef = useRef<((reply: string) => void) | null>(null)

  // Subscribe to chat store: auto-track every generation start/end
  useEffect(() => {
    const unsub = useChatStore.subscribe((state) => {
      const session = state.sessions.get(task.conversationId)
      const isGenerating = session?.isGenerating ?? false

      // Generation started — begin timing
      if (!wasGeneratingRef.current && isGenerating) {
        reportStartTimeRef.current = Date.now()
        reportStageRef.current = selectedTabRef.current
        setSessionReport(null)
      }

      // Generation finished — compute report and process any deferred pipeline action
      if (wasGeneratingRef.current && !isGenerating) {
        const conv = state.conversationCache.get(task.conversationId)
        const msgs = conv?.messages ?? []
        const last = [...msgs].reverse().find((m) => m.role === 'assistant')

        if (reportStartTimeRef.current !== null) {
          const startTime = reportStartTimeRef.current
          const stage = reportStageRef.current
          reportStartTimeRef.current = null
          if (last) {
            setSessionReport({
              durationMs: Date.now() - startTime,
              inputTokens: last.tokenUsage?.inputTokens ?? 0,
              outputTokens: last.tokenUsage?.outputTokens ?? 0,
              fileChanges: last.metadata?.fileChanges ?? undefined,
              stage,
            })
          }
        }

        // Process deferred pipeline action (stages 1/2/3 fire-and-forget)
        const pendingAction = pendingPipelineActionRef.current
        if (pendingAction) {
          pendingPipelineActionRef.current = null
          if (last?.content) {
            pendingAction(last.content)
          }
          setIsSendingMessage(false)
        }

        // Trigger background KB write if knowledge base is configured
        const kbRoot = knowledgeBaseRootRef.current
        const currentTask = taskRef.current
        if (kbRoot && currentTask.knowledgeBaseSpaceId) {
          api.triggerKbWrite({
            kbSpaceId: currentTask.knowledgeBaseSpaceId,
            kbRootPath: kbRoot,
            taskName: currentTask.name,
            taskContext: buildTaskContextForKb(currentTask),
            projectDirs: currentTask.projectDirs ?? [],
          }).catch(err => console.error('[TaskPipelinePanel] Failed to trigger KB write:', err))
        }
      }

      wasGeneratingRef.current = isGenerating
    })
    return unsub
  }, [task.conversationId])

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
      { id: `st-${now}-1`, title: t('分析现有代码结构'), description: t('扫描相关模块，了解当前实现'), status: 'pending', group: t('准备') },
      { id: `st-${now}-2`, title: t('设计接口方案'), description: t('确定 API 入参/出参，与前端对齐'), status: 'pending', group: t('后端') },
      { id: `st-${now}-3`, title: t('实现后端逻辑'), description: t('编写 handler、service、数据库操作'), status: 'pending', group: t('后端') },
      { id: `st-${now}-4`, title: t('前端页面实现'), description: t('新增或修改相关页面和组件'), status: 'pending', group: t('前端') },
      { id: `st-${now}-5`, title: t('编写单元测试'), description: t('覆盖核心逻辑和边界情况'), status: 'pending', group: t('测试') },
    ]
    updateTaskPipelineState(task.id, {
      stage: 2,
      pipelineSubtasks: placeholders,
      pipelineResumeHint: t('子任务已生成，请确认后开始工作'),
    })
    setSelectedTab(2)
  }, [task.id, updateTaskPipelineState, t])

  const getTabCheck = useCallback((tab: PipelineStage): { ok: boolean; message: string } => {
    const prev = assertPreviousPipelineStepReady(tab, task, subtasks, t)
    if (!prev.ok) {
      return { ok: false, message: prev.message }
    }

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
      case 4: {
        const pre = evaluateCodingPrereqs(task, t)
        if (!pre.ok) return { ok: false, message: pre.message }
        return {
          ok: true,
          message: isSimple
            ? t('AI 将根据需求分析直接开始编码。')
            : t('AI will run coding using the saved development plan, projects, and branch.'),
        }
      }
      case 5:
        return { ok: true, message: t('AI 将执行语法检查、依赖检查和编译检查') }
      default:
        return { ok: true, message: '' }
    }
  }, [task, subtasks, t])

  const handleIdentifyIntent = useCallback(async () => {
    if (isIdentifying || isSendingMessage) return
    const gate = getTabCheck(selectedTab)
    setCheckResult(gate)
    if (!gate.ok) return

    setIsIdentifying(true)
    try {
      const chat = useChatStore.getState()
      const dirNames = getInvolvedProjectDirNames(task)
      const codingProjectPaths =
        workspaceRoot ? buildProjectDisplayPaths(workspaceRoot, dirNames) : dirNames

      await chat.sendMessage(
        buildIntentAnalysisMessage(
          selectedTab,
          task,
          {
            subtasks,
            keyPoints: task.requirementKeyPoints ?? [],
            ...(knowledgeBaseRoot ? { knowledgeBaseRoot } : {}),
            ...(selectedTab === 3
              ? { projectDirs: dirNames.length ? dirNames : undefined }
              : {}),
            ...(selectedTab === 4
              ? {
                  codingWorkspaceRoot: workspaceRoot || undefined,
                  codingProjectPaths: codingProjectPaths.length ? codingProjectPaths : undefined,
                }
              : {}),
          },
          t
        )
      )
    } finally {
      setIsIdentifying(false)
    }
  }, [isIdentifying, isSendingMessage, selectedTab, task, subtasks, t, workspaceRoot, knowledgeBaseRoot, getTabCheck])

  const handleStartWork = useCallback(async () => {
    const check = getTabCheck(selectedTab)
    setCheckResult(check)
    if (!check.ok) return

    setIsSendingMessage(true)
    // deferred=true means a pending action was registered; isSendingMessage will be
    // cleared by the subscribe callback when generation ends, not by finally.
    let deferred = false
    try {
      const chat = useChatStore.getState()

      if (selectedTab === 1) {
        // Register deferred action — subscribe callback will call this when generation ends
        pendingPipelineActionRef.current = (reply) => {
          if (reply.trim()) {
            useTaskStore.getState().updateTaskRequirementAnalysis(task.id, reply.trim())
            // For simple tasks, auto-advance to coding stage after requirement identification
            if (isSimple) {
              updateTaskPipelineState(task.id, { stage: 4 })
              setSelectedTab(4)
            }
          }
          // Stay on Tab1 so the user can review the generated analysis before proceeding (complex tasks)
        }
        await chat.sendMessage(buildRequirementIdentifyMessage(task, t, knowledgeBaseRoot ? { knowledgeBaseRoot } : undefined))
        deferred = true

      } else if (selectedTab === 2) {
        pendingPipelineActionRef.current = (reply) => {
          const generated = extractSubtasks(reply)
          if (generated.length > 0) {
            updateTaskPipelineState(task.id, {
              pipelineSubtasks: generated,
              stage: Math.max(stage, 2) as PipelineStage,
            })
          }
          setSelectedTab(2)
        }
        await chat.sendMessage(buildTaskBreakdownExecuteMessage(t, knowledgeBaseRoot ? { knowledgeBaseRoot } : undefined))
        deferred = true

      } else if (selectedTab === 3) {
        // Validate project paths before generating dev plan
        const tab3ProjectDirs = getInvolvedProjectDirNames(task)
        if (tab3ProjectDirs.length > 0 && workspaceRoot) {
          const missing: string[] = []
          await Promise.all(
            tab3ProjectDirs.map(async (dir) => {
              const fullPath = `${workspaceRoot}/${dir}`
              const res = await api.checkPathExists(fullPath)
              if (!res.success || !res.data?.exists) missing.push(fullPath)
            })
          )
          if (missing.length > 0) {
            setCheckResult({ ok: false, message: t('以下项目路径不存在，请确认后再试：\n') + missing.join('\n') })
            return
          }
        }
        pendingPipelineActionRef.current = (reply) => {
          const { projectChanges, scopeText } = parseDevPlanReply(reply)
          updateTaskPipelineState(task.id, {
            pipelineDevPlan: scopeText || reply.trim(),
            pipelineProjectChanges: projectChanges || undefined,
            stage: Math.max(stage, 3) as PipelineStage,
          })
          setSelectedTab(3)
        }
        const tab3Opts = knowledgeBaseRoot
          ? { knowledgeBaseRoot, projectDirs: tab3ProjectDirs.length ? tab3ProjectDirs : undefined }
          : undefined
        await chat.sendMessage(buildDevPlanExecuteMessage(t, tab3Opts))
        deferred = true

      } else if (selectedTab === 4) {
        const dirs = getInvolvedProjectDirNames(task)
        // Validate project paths before starting coding
        if (dirs.length > 0 && workspaceRoot) {
          const missing: string[] = []
          await Promise.all(
            dirs.map(async (dir) => {
              const fullPath = `${workspaceRoot}/${dir}`
              const res = await api.checkPathExists(fullPath)
              if (!res.success || !res.data?.exists) missing.push(fullPath)
            })
          )
          if (missing.length > 0) {
            setCheckResult({ ok: false, message: t('以下项目路径不存在，请确认后再试：\n') + missing.join('\n') })
            return
          }
        }
        const projectPaths = buildProjectDisplayPaths(workspaceRoot, dirs)
        const focus = pickFocusSubtask(subtasks)
        const logLine = t('Coding kickoff log line', {
          time: new Date().toLocaleString(),
          subtask: focus?.title?.trim() || t('No subtask'),
          projects: dirs.length ? dirs.join(', ') : t('None'),
        })
        useTaskStore.getState().appendPipelineCodingLog(task.id, logLine)

        updateTaskPipelineState(task.id, {
          stage: Math.max(stage, 4) as PipelineStage,
          pipelineResumeHint: t('正在编写代码'),
        })
        await chat.sendMessage(
          buildCodingKickoffMessage(task, t, {
            workspaceRoot: workspaceRoot || undefined,
            projectPaths: projectPaths.length ? projectPaths : undefined,
            ...(knowledgeBaseRoot ? { knowledgeBaseRoot } : {}),
          })
        )

      } else if (selectedTab === 5) {
        updateTaskPipelineState(task.id, { stage: 5, pipelineResumeHint: t('正在执行验证检查') })
        await chat.sendMessage(
          buildVerificationExecuteMessage(task, t, {
            depCheckCmd: task.pipelineDepCheckCmd,
            buildCheckCmd: task.pipelineBuildCheckCmd,
            apiTestCmd: task.pipelineApiTestCmd,
            knowledgeBaseRoot: knowledgeBaseRoot || undefined,
          })
        )
      }
    } catch (e) {
      // On error, cancel any pending action and release the sending lock immediately
      pendingPipelineActionRef.current = null
      deferred = false
      throw e
    } finally {
      if (!deferred) {
        setIsSendingMessage(false)
      }
    }
  }, [selectedTab, stage, task, subtasks, getTabCheck, updateTaskPipelineState, t, workspaceRoot, knowledgeBaseRoot, isSimple])

  const handleSaveDevPlan = useCallback(
    (text: string) => updateTaskPipelineState(task.id, { pipelineDevPlan: text }),
    [task.id, updateTaskPipelineState]
  )

  const handleSaveDepCheckCmd = useCallback(
    (cmd: string) => updateTaskPipelineState(task.id, { pipelineDepCheckCmd: cmd }),
    [task.id, updateTaskPipelineState]
  )

  const handleSaveBuildCheckCmd = useCallback(
    (cmd: string) => updateTaskPipelineState(task.id, { pipelineBuildCheckCmd: cmd }),
    [task.id, updateTaskPipelineState]
  )

  const handleSaveApiTestCmd = useCallback(
    (cmd: string) => updateTaskPipelineState(task.id, { pipelineApiTestCmd: cmd }),
    [task.id, updateTaskPipelineState]
  )

  // ── render ──

  return (
    <div className="border-b border-border bg-card/60 flex flex-col">
      {/* Header: tab bar + progress badge + collapse toggle */}
      <div className="flex items-center gap-2 px-3 py-2 min-h-[40px]">
        <StageTabBar
          stage={stage}
          selectedTab={selectedTab}
          visibleStages={visibleStageIds}
          onSelect={(id) => {
            setSelectedTab(id)
            if (collapsed) setCollapsed(false)
          }}
        />
        {subtasks.length > 0 && (
          <span className="flex-shrink-0 text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-secondary">
            {doneCount}/{subtasks.length}
          </span>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex-shrink-0 px-2 py-1.5 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
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
                isSimple={isSimple}
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
              <Tab3DevPlan
                task={task}
                workspaceRoot={workspaceRootForUi}
                onSaveDevPlan={handleSaveDevPlan}
                onSaveBranchName={(b) => updateTaskBranchName(task.id, b)}
                onAddProject={(dir) => addProjectDirToTask(task.id, dir)}
                onRemoveProject={(dir) => removeProjectDirFromTask(task.id, dir)}
              />
            )}
            {selectedTab === 4 && (
              <Tab4Coding task={task} workspaceRoot={workspaceRootForUi} subtasks={subtasks} />
            )}
            {selectedTab === 5 && (
              <Tab5Review
                task={task}
                onSaveDepCheckCmd={handleSaveDepCheckCmd}
                onSaveBuildCheckCmd={handleSaveBuildCheckCmd}
                onSaveApiTestCmd={handleSaveApiTestCmd}
              />
            )}
          </div>

          {/* Action row — always visible */}
          <div className="flex flex-col border-t border-border/50">
            <div className="flex items-center gap-2 px-3 py-2">
              {resumeHint && !checkResult && (
                <span className="flex-1 text-[11px] text-muted-foreground truncate">{resumeHint}</span>
              )}
              {(!resumeHint || checkResult) && <span className="flex-1" />}

              {selectedTab === 1 && (
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

              <button
                type="button"
                onClick={() => setCollapsed(true)}
                className="flex-shrink-0 p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
                title={t('Collapse')}
              >
                <ChevronUp className="w-3.5 h-3.5" />
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

            {/* Session report card */}
            {sessionReport && !isSendingMessage && (
              <SessionReportCard report={sessionReport} />
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
