/**
 * Home page — workspace tasks list and create dialog
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { FileText, HelpCircle, ListTodo, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useAppStore } from '../../stores/app.store'
import { useChatStore } from '../../stores/chat.store'
import { useSpaceStore } from '../../stores/space.store'
import { useTaskStore } from '../../stores/task.store'
import type { Space } from '../../types'
import { extractWordDocument } from '../../utils/wordDocumentExtract'
import { DOC_IMG_PLACEHOLDER_PREFIX } from '../../utils/wordDocumentExtract'
import { api } from '../../api'
import { useConfirmDialog } from '../../hooks/useConfirmDialog'

const isWebMode = api.isRemoteMode()

/** Sentinel for <select> "none" — avoids controlled-select glitches when clearing the other field. */
const SPACE_SELECT_NONE = '__none__'

function isKnowledgeBaseSpace(s: Space): boolean {
  return s.workspaceKind === 'knowledge_base'
}

function resolveSpacePath(spaces: Space[], spaceId: string): string | undefined {
  const sp = spaces.find((s) => s.id === spaceId)
  return sp ? (sp.workingDir || sp.path || undefined) : undefined
}

function formatTaskCreatedAt(ms: number, locale: string): string {
  try {
    return new Date(ms).toLocaleString(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  } catch {
    return new Date(ms).toLocaleString()
  }
}

export function HomeTasksPanel() {
  const { t, i18n } = useTranslation()
  const { showConfirm, DialogComponent } = useConfirmDialog()
  const setView = useAppStore((s) => s.setView)
  const { devxSpace, spaces, setCurrentSpace, refreshCurrentSpace } = useSpaceStore()
  const tasks = useTaskStore((s) => s.tasks)
  const removeTask = useTaskStore((s) => s.removeTask)
  const setActiveTask = useTaskStore((s) => s.setActiveTask)
  const pendingRequirementTaskId = useTaskStore((s) => s.pendingRequirementTaskId)
  const clearPendingRequirementTask = useTaskStore((s) => s.clearPendingRequirementTask)
  const updateTaskRequirementDoc = useTaskStore((s) => s.updateTaskRequirementDoc)
  const updateTaskName = useTaskStore((s) => s.updateTaskName)
  const moveTaskToSpace = useTaskStore((s) => s.moveTaskToSpace)
  const updateTaskKnowledgeBaseSpaceId = useTaskStore((s) => s.updateTaskKnowledgeBaseSpaceId)

  const [showDialog, setShowDialog] = useState(false)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [taskName, setTaskName] = useState('')
  /** Mirrors regular workspace choice (task `spaceId` is always a regular space). */
  const [spaceId, setSpaceId] = useState<string>('')
  /** Regular workspace for this task — sole source for `spaceId` on create/save. */
  const [regularSelection, setRegularSelection] = useState<string>(SPACE_SELECT_NONE)
  /** Knowledge-base dropdown; independent of `spaceId`. */
  const [kbSelection, setKbSelection] = useState<string>(SPACE_SELECT_NONE)
  const [requirementDocName, setRequirementDocName] = useState('')
  const [requirementDocContent, setRequirementDocContent] = useState('')
  const [requirementDescription, setRequirementDescription] = useState('')
  const [isParsingDoc, setIsParsingDoc] = useState(false)
  const [creating, setCreating] = useState(false)
  const [taskType, setTaskType] = useState<'simple' | 'complex'>('complex')
  const requirementInputRef = useRef<HTMLInputElement>(null)
  const addTask = useTaskStore((s) => s.addTask)

  const handleRequestDeleteTask = useCallback(
    async (taskId: string, taskDisplayName: string) => {
      const ok = await showConfirm({
        title: t('Delete workspace task \"{{name}}\"?', { name: taskDisplayName }),
        message: t(
          'The task is removed from the task list only. The linked conversation and chat history remain in the space.'
        ),
        confirmLabel: t('Delete'),
        cancelLabel: t('Cancel'),
        variant: 'danger',
      })
      if (!ok) return
      removeTask(taskId)
    },
    [removeTask, showConfirm, t]
  )

  const knowledgeBaseSpaces: Space[] = useMemo(
    () => spaces.filter((s) => isKnowledgeBaseSpace(s)),
    [spaces]
  )

  const knowledgeBaseIdSet = useMemo(
    () => new Set(knowledgeBaseSpaces.map((s) => s.id)),
    [knowledgeBaseSpaces]
  )

  const regularSpaces: Space[] = useMemo(() => {
    const list: Space[] = []
    if (devxSpace && !knowledgeBaseIdSet.has(devxSpace.id) && !isKnowledgeBaseSpace(devxSpace)) {
      list.push(devxSpace)
    }
    for (const s of spaces) {
      if (knowledgeBaseIdSet.has(s.id) || isKnowledgeBaseSpace(s)) continue
      list.push(s)
    }
    return list
  }, [devxSpace, spaces, knowledgeBaseIdSet])

  const allSpaces: Space[] = useMemo(() => {
    const list: Space[] = []
    if (devxSpace) list.push(devxSpace)
    list.push(...spaces)
    return list
  }, [devxSpace, spaces])

  const spaceNameById = useMemo(() => {
    const m: Record<string, string> = {}
    for (const s of allSpaces) m[s.id] = s.isTemp ? t('DevX') : s.name
    return m
  }, [allSpaces, t])

  const openCreateDialog = () => {
    setEditingTaskId(null)
    setTaskName('')
    setRequirementDocName('')
    setRequirementDocContent('')
    setRequirementDescription('')
    setTaskType('complex')
    const firstReg = regularSpaces[0]?.id
    const firstKb = knowledgeBaseSpaces[0]?.id
    setRegularSelection(firstReg ?? SPACE_SELECT_NONE)
    setKbSelection(firstKb ?? SPACE_SELECT_NONE)
    if (firstReg) setSpaceId(firstReg)
    else setSpaceId('')
    setShowDialog(true)
  }

  const resetDialog = () => {
    setShowDialog(false)
    setEditingTaskId(null)
    setTaskName('')
    setRequirementDocName('')
    setRequirementDocContent('')
    setRequirementDescription('')
    setSpaceId('')
    setRegularSelection(SPACE_SELECT_NONE)
    setKbSelection(SPACE_SELECT_NONE)
    setTaskType('complex')
    setIsParsingDoc(false)
  }

  const handleRequirementUpload = async (e: ChangeEvent<HTMLInputElement>) => {
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
      setRequirementDocName(file.name)
      setRequirementDocContent(normalized)
    } finally {
      setIsParsingDoc(false)
    }
  }

  const handleCreate = async () => {
    const name = taskName.trim()
    const sid =
      regularSelection !== SPACE_SELECT_NONE ? regularSelection.trim() : ''
    const requirementName = requirementDocName.trim()
    const requirementContent = requirementDocContent.trim()
    const requirementDesc = requirementDescription.trim()
    const hasDoc = Boolean(requirementName && requirementContent)
    const sidOk = Boolean(sid) && regularSpaces.some((s) => s.id === sid)
    if (!name || !sidOk || (!hasDoc && !requirementDesc)) return
    const kbPersist =
      kbSelection !== SPACE_SELECT_NONE && knowledgeBaseSpaces.some((s) => s.id === kbSelection)
        ? kbSelection
        : undefined
    const spacePath = resolveSpacePath(regularSpaces, sid)
    const kbRootPath = kbPersist ? resolveSpacePath(knowledgeBaseSpaces, kbPersist) : undefined
    setCreating(true)
    try {
      const task = await addTask({
        name,
        spaceId: sid,
        ...(kbPersist ? { knowledgeBaseSpaceId: kbPersist } : {}),
        requirementDocName: requirementName,
        requirementDocContent: requirementContent,
        requirementDescription: requirementDesc,
        projectDirs: [],
        branchName: '',
        taskType,
        ...(spacePath ? { spacePath } : {}),
        ...(kbRootPath ? { kbRootPath } : {}),
      })
      if (task) resetDialog()
    } finally {
      setCreating(false)
    }
  }

  const openEditTaskDialog = useCallback(
    (taskId: string) => {
      const task = tasks.find((x) => x.id === taskId)
      if (!task) return
      const sid = task.spaceId
      const inRegular = regularSpaces.some((s) => s.id === sid)
      const inKb = knowledgeBaseSpaces.some((s) => s.id === sid)
      const linkedKb = task.knowledgeBaseSpaceId?.trim()
      const linkedKbValid = Boolean(linkedKb && knowledgeBaseSpaces.some((s) => s.id === linkedKb))
      setEditingTaskId(task.id)
      setTaskName(task.name)
      setSpaceId(inRegular ? sid : '')
      setRegularSelection(inRegular ? sid : SPACE_SELECT_NONE)
      setKbSelection(linkedKbValid && linkedKb ? linkedKb : inKb ? sid : SPACE_SELECT_NONE)
      setRequirementDocName(task.requirementDocName || '')
      setRequirementDocContent(task.requirementDocContent || '')
      setRequirementDescription(task.requirementDescription || '')
      setTaskType(task.taskType ?? 'complex')
      setShowDialog(true)
    },
    [tasks, regularSpaces, knowledgeBaseSpaces]
  )

  const handleSaveTask = async () => {
    if (!editingTaskId) return
    const orig = tasks.find((t) => t.id === editingTaskId)
    if (!orig) return
    const name = taskName.trim()
    const sid =
      regularSelection !== SPACE_SELECT_NONE ? regularSelection.trim() : ''
    const requirementName = requirementDocName.trim()
    const requirementContent = requirementDocContent.trim()
    const requirementDesc = requirementDescription.trim()
    const hasDoc = Boolean(requirementName && requirementContent)
    const sidOk = Boolean(sid) && regularSpaces.some((s) => s.id === sid)
    if (!name || !sidOk || (!hasDoc && !requirementDesc)) return
    setCreating(true)
    try {
      updateTaskName(editingTaskId, name)
      if (sid !== orig.spaceId) {
        const newSpacePath = resolveSpacePath(regularSpaces, sid)
        const ok = await moveTaskToSpace(editingTaskId, sid, newSpacePath)
        if (!ok) return
      }
      updateTaskRequirementDoc(editingTaskId, requirementName, requirementContent, requirementDesc)
      const kbPersist =
        kbSelection !== SPACE_SELECT_NONE && knowledgeBaseSpaces.some((s) => s.id === kbSelection)
          ? kbSelection
          : null
      const newKbRootPath = kbPersist ? resolveSpacePath(knowledgeBaseSpaces, kbPersist) : undefined
      updateTaskKnowledgeBaseSpaceId(editingTaskId, kbPersist, newKbRootPath)
      resetDialog()
    } finally {
      setCreating(false)
    }
  }

  useEffect(() => {
    if (!pendingRequirementTaskId) return
    openEditTaskDialog(pendingRequirementTaskId)
    clearPendingRequirementTask()
  }, [pendingRequirementTaskId, openEditTaskDialog, clearPendingRequirementTask])

  const handleOpenTask = useCallback(
    async (taskId: string) => {
      const task = tasks.find((x) => x.id === taskId)
      if (!task) return
      const hasDoc = Boolean(task.requirementDocName?.trim() && task.requirementDocContent?.trim())
      const hasDesc = Boolean(task.requirementDescription?.trim())
      if (!hasDoc && !hasDesc) {
        openEditTaskDialog(task.id)
        return
      }
      const space = allSpaces.find((s) => s.id === task.spaceId)
      if (!space) return
      if (isKnowledgeBaseSpace(space)) {
        openEditTaskDialog(task.id)
        return
      }

      const chatBefore = useChatStore.getState()
      const alreadyOnSpace = chatBefore.currentSpaceId === space.id
      const taskMetaPresent =
        chatBefore
          .getSpaceState(space.id)
          .conversations.some((c) => c.id === task.conversationId)

      setCurrentSpace(space)
      setActiveTask(task.id)
      useChatStore.getState().setCurrentSpace(space.id)

      await refreshCurrentSpace()

      if (!alreadyOnSpace || !taskMetaPresent) {
        await useChatStore.getState().loadConversations(space.id, { silent: true })
      }

      await useChatStore.getState().selectConversation(task.conversationId)
      setView('space')
    },
    [tasks, allSpaces, setCurrentSpace, refreshCurrentSpace, setActiveTask, setView, openEditTaskDialog]
  )

  const workspaceValid =
    regularSelection !== SPACE_SELECT_NONE &&
    regularSpaces.some((s) => s.id === regularSelection)
  const requirementReady =
    (requirementDocName.trim().length > 0 && requirementDocContent.trim().length > 0) ||
    requirementDescription.trim().length > 0

  const canPickSpace = regularSpaces.length > 0

  const selectInvalidClass = !workspaceValid
    ? 'border-destructive focus:border-destructive'
    : 'border-border focus:border-primary'

  if (isWebMode) {
    return null
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <ListTodo className="w-4 h-4" />
          {t('任务管理')}
        </h3>
        <button
          type="button"
          onClick={openCreateDialog}
          disabled={regularSpaces.length === 0}
          className="flex items-center gap-1 px-3 py-1 text-sm text-primary hover:bg-primary/10 rounded-lg transition-colors disabled:opacity-50 disabled:pointer-events-none"
        >
          <Plus className="w-4 h-4" />
          {t('新建')}
        </button>
      </div>

      {tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground mb-3">{t('暂无任务')}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          {tasks.map((task) => {
            const sp = allSpaces.find((s) => s.id === task.spaceId)
            const boundKb = Boolean(sp && isKnowledgeBaseSpace(sp))
            const displayName = spaceNameById[task.spaceId] ?? task.spaceId
            const linkedKbId = task.knowledgeBaseSpaceId?.trim()
            const linkedSp = linkedKbId ? allSpaces.find((s) => s.id === linkedKbId) : undefined
            const linkedIsKb = Boolean(linkedSp && isKnowledgeBaseSpace(linkedSp))
            const kbRowName =
              linkedKbId && linkedIsKb
                ? (spaceNameById[linkedKbId] ?? linkedKbId)
                : boundKb
                  ? displayName
                  : null
            return (
              <div
                key={task.id}
                className="rounded-xl border border-border p-4 hover:border-primary/40 hover:bg-secondary/40 transition-colors group"
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => void handleOpenTask(task.id)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-medium truncate">{task.name}</span>
                      <span className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-full leading-none ${
                        (task.taskType ?? 'complex') === 'simple'
                          ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                          : 'bg-violet-500/15 text-violet-600 dark:text-violet-400'
                      }`}>
                        {(task.taskType ?? 'complex') === 'simple' ? t('简单') : t('复杂')}
                      </span>
                    </div>
                    <div className="text-xs mt-1 line-clamp-2">
                      <span className="text-foreground">{t('Requirement document')}：</span>
                      <span className="text-muted-foreground">
                        {task.requirementDocName ||
                          (task.requirementDescription ? t('Requirement description') : t('无'))}
                      </span>
                    </div>
                    <div className="text-xs mt-1">
                      <span className="text-foreground">{t('常规空间')}：</span>
                      <span className="text-muted-foreground">
                        {boundKb ? t('无') : displayName}
                      </span>
                    </div>
                    <div className="text-xs mt-1">
                      <span className="text-foreground">{t('知识库')}：</span>
                      <span className="text-muted-foreground">
                        {kbRowName ?? t('无')}
                      </span>
                    </div>
                    <div className="text-xs mt-1">
                      <span className="text-foreground">{t('创建时间')}：</span>
                      <span className="text-muted-foreground">
                        {typeof task.createdAt === 'number'
                          ? formatTaskCreatedAt(task.createdAt, i18n.language)
                          : typeof task.updatedAt === 'number'
                            ? formatTaskCreatedAt(task.updatedAt, i18n.language)
                            : t('无')}
                      </span>
                    </div>
                  </button>
                  <div className="flex shrink-0 items-start gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        openEditTaskDialog(task.id)
                      }}
                      className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                      title={t('Edit task')}
                      aria-label={t('Edit task')}
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleRequestDeleteTask(task.id, task.name)
                      }}
                      className="p-1 rounded hover:bg-destructive/15 text-destructive transition-colors"
                      title={t('Delete')}
                      aria-label={t('Delete')}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="mb-6 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
        <p className="text-xs text-muted-foreground leading-relaxed flex gap-2">
          <HelpCircle
            className="w-4 h-4 shrink-0 text-foreground/60 mt-0.5"
            aria-hidden
          />
          <span>
            {t(
              'Tasks implement product requirements in code. Typically one requirement corresponds to one task; a task may involve changes across multiple projects in the space.'
            )}
          </span>
        </p>
      </div>

      {showDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto animate-fade-in">
            <h2 className="text-lg font-medium mb-4">
              {editingTaskId ? t('Edit task') : t('新建任务')}
            </h2>

            <div className="mb-4">
              <label className="block text-sm text-muted-foreground mb-2">{t('任务名称')}</label>
              <input
                type="text"
                value={taskName}
                onChange={(e) => setTaskName(e.target.value)}
                placeholder={t('例如：用户登录迭代')}
                className="w-full px-4 py-2 bg-input rounded-lg border border-border focus:border-primary focus:outline-none transition-colors"
              />
            </div>

            {editingTaskId && (
              <div className="mb-4">
                <label className="block text-sm text-muted-foreground mb-2">{t('任务类型')}</label>
                <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm ${
                  taskType === 'simple'
                    ? 'border-blue-500/30 bg-blue-500/8 text-blue-700 dark:text-blue-400'
                    : 'border-violet-500/30 bg-violet-500/8 text-violet-700 dark:text-violet-400'
                }`}>
                  <span>{taskType === 'simple' ? t('简单任务') : t('复杂任务')}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {taskType === 'simple'
                      ? t('需求识别 → 编码实现 → 用例验证')
                      : t('需求识别 → 任务拆解 → 开发计划 → 编码 → 验证')}
                  </span>
                </div>
              </div>
            )}

            {!editingTaskId && (
              <div className="mb-4">
                <label className="block text-sm text-muted-foreground mb-2">{t('任务类型')}</label>
                <div className="flex gap-2">
                  {(['complex', 'simple'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setTaskType(type)}
                      className={`flex-1 flex flex-col items-start gap-0.5 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                        taskType === type
                          ? 'border-primary bg-primary/10 text-foreground'
                          : 'border-border hover:bg-secondary text-muted-foreground'
                      }`}
                    >
                      <span className="text-sm font-medium">
                        {type === 'complex' ? t('复杂任务') : t('简单任务')}
                      </span>
                      <span className="text-[11px] text-muted-foreground leading-snug">
                        {type === 'complex'
                          ? t('需求识别 → 任务拆解 → 开发计划 → 编码 → 验证')
                          : t('需求识别 → 编码实现 → 用例验证')}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mb-4">
              <label className="block text-sm text-muted-foreground mb-2">{t('Requirement document')}</label>
              <input
                ref={requirementInputRef}
                type="file"
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(e) => void handleRequirementUpload(e)}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => requirementInputRef.current?.click()}
                disabled={isParsingDoc}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-secondary transition-colors disabled:opacity-60"
              >
                <Upload className="w-4 h-4" />
                {isParsingDoc ? t('Processing Word document...') : t('Upload requirement document (.docx)')}
              </button>
              <div className="mt-2 min-h-6 text-xs text-muted-foreground">
                {requirementDocName ? (
                  <span className="inline-flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5" />
                    {requirementDocName}
                  </span>
                ) : (
                  t('Requirement document or description is required.')
                )}
              </div>
            </div>

            <div className="mb-6">
              <label className="block text-sm text-muted-foreground mb-2">{t('Requirement description')}</label>
              <textarea
                value={requirementDescription}
                onChange={(e) => setRequirementDescription(e.target.value)}
                rows={4}
                placeholder={t('Describe requirement details when no Word document is provided')}
                className="w-full px-4 py-2 bg-input rounded-lg border border-border focus:border-primary focus:outline-none transition-colors resize-y"
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm text-muted-foreground mb-2">{t('常规空间')}</label>
              <select
                value={regularSelection}
                onChange={(e) => {
                  const v = e.target.value
                  setRegularSelection(v)
                  if (v !== SPACE_SELECT_NONE) {
                    setSpaceId(v)
                    return
                  }
                  setSpaceId('')
                }}
                disabled={regularSpaces.length === 0}
                className={`w-full px-4 py-2 bg-input rounded-lg border focus:outline-none transition-colors disabled:opacity-60 ${selectInvalidClass}`}
              >
                <option value={SPACE_SELECT_NONE}>{t('无')}</option>
                {regularSpaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.isTemp ? t('DevX') : s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-4">
              <label className="block text-sm text-muted-foreground mb-2">{t('知识库')}</label>
              <select
                value={kbSelection}
                onChange={(e) => {
                  const v = e.target.value
                  setKbSelection(v)
                }}
                disabled={knowledgeBaseSpaces.length === 0}
                className={`w-full px-4 py-2 bg-input rounded-lg border focus:outline-none transition-colors disabled:opacity-60 ${selectInvalidClass}`}
              >
                <option value={SPACE_SELECT_NONE}>{t('无')}</option>
                {knowledgeBaseSpaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <p className="mb-4 text-xs text-muted-foreground">
              {t(
                'Pick a regular workspace for implementation. Knowledge base is optional and only enriches prompts with existing docs — it is not the task workspace.'
              )}
            </p>

            {editingTaskId && !requirementReady && (
              <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-foreground">
                {t(
                  'This task has no requirement document or description. Please provide one before opening the task conversation.'
                )}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={resetDialog}
                className="px-4 py-2 text-muted-foreground hover:bg-secondary rounded-lg transition-colors"
              >
                {t('取消')}
              </button>
              <button
                type="button"
                onClick={() => void (editingTaskId ? handleSaveTask() : handleCreate())}
                disabled={
                  creating ||
                  !taskName.trim() ||
                  !workspaceValid ||
                  !requirementReady ||
                  !canPickSpace
                }
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {editingTaskId ? t('Save') : t('创建')}
              </button>
            </div>
          </div>
        </div>
      )}
      {DialogComponent}
    </>
  )
}
