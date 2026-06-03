/**
 * Home page — workspace tasks list and create dialog
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { FileText, FolderOpen, ListTodo, Pencil, Plus, Trash2, Upload, X } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useAppStore } from '../../stores/app.store'
import { useChatStore } from '../../stores/chat.store'
import { useSpaceStore } from '../../stores/space.store'
import { useTaskStore } from '../../stores/task.store'
import type { Space } from '../../types'
import { extractDocument } from '../../utils/documentExtract'
import { api } from '../../api'
import { useConfirmDialog } from '../../hooks/useConfirmDialog'

const isWebMode = api.isRemoteMode()

/** Sentinel for <select> "none" — avoids controlled-select glitches when clearing the other field. */
const SPACE_SELECT_NONE = '__none__'

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

/** Generate a unique task name by appending -2, -3, etc. when duplicates exist. */
function generateUniqueName(baseName: string, existingTasks: { name: string }[]): string {
  const existing = new Set(existingTasks.map(t => t.name))
  if (!existing.has(baseName)) return baseName
  let counter = 2
  while (existing.has(`${baseName}-${counter}`)) {
    counter++
  }
  return `${baseName}-${counter}`
}

export function HomeTasksPanel() {
  const { t, i18n } = useTranslation()
  const { showConfirm, DialogComponent } = useConfirmDialog()
  const setView = useAppStore((s) => s.setView)
  const { devxSpace, spaces, setCurrentSpace, refreshCurrentSpace } = useSpaceStore()
  const tasks = useTaskStore((s) => s.tasks.filter(t => !t.archived))
  const removeTask = useTaskStore((s) => s.removeTask)
  const setActiveTask = useTaskStore((s) => s.setActiveTask)
  const pendingRequirementTaskId = useTaskStore((s) => s.pendingRequirementTaskId)
  const clearPendingRequirementTask = useTaskStore((s) => s.clearPendingRequirementTask)
  const updateTaskRequirementDoc = useTaskStore((s) => s.updateTaskRequirementDoc)
  const updateTaskName = useTaskStore((s) => s.updateTaskName)
  const moveTaskToSpace = useTaskStore((s) => s.moveTaskToSpace)

  const addProjectDirToTask = useTaskStore((s) => s.addProjectDirToTask)
  const removeProjectDirFromTask = useTaskStore((s) => s.removeProjectDirFromTask)

  const [showDialog, setShowDialog] = useState(false)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [taskName, setTaskName] = useState('')
  const [projectDir, setProjectDir] = useState<string | null>(null)
  /** Mirrors regular workspace choice (task `spaceId` is always a regular space). */
  const [spaceId, setSpaceId] = useState<string>('')
  /** Regular workspace for this task — sole source for `spaceId` on create/save. */
  const [regularSelection, setRegularSelection] = useState<string>(SPACE_SELECT_NONE)
  const [requirementDocName, setRequirementDocName] = useState('')
  const [requirementDocContent, setRequirementDocContent] = useState('')
  const [requirementDescription, setRequirementDescription] = useState('')
  const [isParsingDoc, setIsParsingDoc] = useState(false)
  const [creating, setCreating] = useState(false)
  const [taskType, setTaskType] = useState<'simple' | 'complex'>('simple')
  const requirementInputRef = useRef<HTMLInputElement>(null)
  const addTask = useTaskStore((s) => s.addTask)

  const handleRequestDeleteTask = useCallback(
    async (taskId: string, taskDisplayName: string) => {
      const ok = await showConfirm({
        title: t('Delete workspace task "{{name}}"?', { name: taskDisplayName }),
        message: t(
          'The task and its linked conversation and chat history will be permanently deleted.'
        ),
        confirmLabel: t('Delete'),
        cancelLabel: t('Cancel'),
        variant: 'danger',
      })
      if (!ok) return

      // Capture task info before removing from store
      const task = useTaskStore.getState().tasks.find(t => t.id === taskId)
      removeTask(taskId)

      if (task?.spaceId && task?.conversationId) {
        useChatStore.getState().deleteConversation(task.spaceId, task.conversationId).catch(err =>
          console.error('[HomeTasksPanel] Failed to delete task conversation:', err)
        )
      }
    },
    [removeTask, showConfirm, t]
  )

  const regularSpaces: Space[] = useMemo(() => {
    const list: Space[] = []
    if (devxSpace) list.push(devxSpace)
    list.push(...spaces)
    return list
  }, [devxSpace, spaces])

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

  const spaceById = useMemo(() => {
    const m: Record<string, (typeof allSpaces)[0]> = {}
    for (const s of allSpaces) m[s.id] = s
    return m
  }, [allSpaces])

  const openCreateDialog = () => {
    setEditingTaskId(null)
    setTaskName('')
    setProjectDir(null)
    setRequirementDocName('')
    setRequirementDocContent('')
    setRequirementDescription('')
    setCreating(false)
    const firstReg = regularSpaces[0]?.id
    setRegularSelection(firstReg ?? SPACE_SELECT_NONE)
    if (firstReg) setSpaceId(firstReg)
    else setSpaceId('')
    setShowDialog(true)
  }

  const resetDialog = () => {
    setShowDialog(false)
    setEditingTaskId(null)
    setTaskName('')
    setProjectDir(null)
    setRequirementDocName('')
    setRequirementDocContent('')
    setRequirementDescription('')
    setSpaceId('')
    setRegularSelection(SPACE_SELECT_NONE)
    setTaskType('simple')
    setCreating(false)
    setIsParsingDoc(false)
  }

  const handleRequirementUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    e.target.value = ''
    setIsParsingDoc(true)
    try {
      const docNames: string[] = []
      const contents: string[] = []
      for (const file of files) {
        const result = await extractDocument(file, {
          unsupportedImageLabel: t('Word document image omitted'),
        })
        const normalized = result.text
          // Remove image placeholders for non-docx formats (no-op for docx)
          .replace(/\n?\[DOCIMG:\d+\]\n?/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim()
        docNames.push(file.name)
        if (files.length > 1) {
          contents.push(`=== ${file.name} ===\n${normalized}`)
        } else {
          contents.push(normalized)
        }
      }
      setRequirementDocName(docNames.join(', '))
      setRequirementDocContent(contents.join('\n\n'))
    } finally {
      setIsParsingDoc(false)
    }
  }

  const handleSelectProjectDir = async () => {
    const res = await api.selectFolder()
    if (res.success && res.data) {
      const path = res.data as string
      setProjectDir(path)
      // Auto-generate task name from directory name
      const dirName = path.replace(/[/\\]$/, '').split(/[/\\]/).pop() || ''
      if (dirName) {
        setTaskName(generateUniqueName(dirName, tasks))
      }
    }
  }

  const handleCreate = async () => {
    setCreating(true)
    try {
      if (taskType === 'simple') {
        const name = taskName.trim()
        if (!name || !projectDir) return

        const task = await addTask({
          name,
          spaceId: devxSpace?.id ?? '',
          requirementDocName: '',
          requirementDocContent: '',
          requirementDescription: '',
          projectDirs: [projectDir],
          branchName: '',
          taskType: 'simple',
        })
        if (task) {
          resetDialog()
          // Auto-navigate to the task conversation
          if (devxSpace) {
            setCurrentSpace(devxSpace)
            setActiveTask(task.id)
            useChatStore.getState().setCurrentSpace(devxSpace.id)
            setView('space')
          }
        }
      } else {
        const requirementName = requirementDocName.trim()
        const requirementContent = requirementDocContent.trim()
        const requirementDesc = requirementDescription.trim()
        const hasDoc = Boolean(requirementName && requirementContent)
        const name = taskName.trim()
        if (!name || (!hasDoc && !requirementDesc)) return

        const sid = regularSelection !== SPACE_SELECT_NONE ? regularSelection.trim() : ''
        const sidOk = Boolean(sid) && regularSpaces.some((s) => s.id === sid)
        if (!sidOk) return
        const spacePath = resolveSpacePath(regularSpaces, sid)

        const task = await addTask({
          name,
          spaceId: sid,
          requirementDocName: requirementName,
          requirementDocContent: requirementContent,
          requirementDescription: requirementDesc,
          projectDirs: [],
          branchName: '',
          taskType: 'complex',
          ...(spacePath ? { spacePath } : {}),
        })
        if (task) resetDialog()
      }
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
      setEditingTaskId(task.id)
      setTaskName(task.name)
      setProjectDir(task.projectDirs[0] || null)
      setSpaceId(inRegular ? sid : '')
      setRegularSelection(inRegular ? sid : SPACE_SELECT_NONE)
      setRequirementDocName(task.requirementDocName || '')
      setRequirementDocContent(task.requirementDocContent || '')
      setRequirementDescription(task.requirementDescription || '')
      setTaskType(task.taskType ?? 'simple')
      setShowDialog(true)
    },
    [tasks, regularSpaces]
  )

  const handleSaveTask = async () => {
    if (!editingTaskId) return
    const orig = tasks.find((t) => t.id === editingTaskId)
    if (!orig) return
    const name = taskName.trim()
    if (!name) return
    setCreating(true)
    try {
      updateTaskName(editingTaskId, name)
      if (taskType === 'simple') {
        // Update project directory
        if (projectDir && projectDir !== (orig.projectDirs[0] || null)) {
          for (const dir of orig.projectDirs || []) {
            removeProjectDirFromTask(editingTaskId, dir)
          }
          addProjectDirToTask(editingTaskId, projectDir)
        }
      } else {
        const sid = regularSelection !== SPACE_SELECT_NONE ? regularSelection.trim() : ''
        const requirementName = requirementDocName.trim()
        const requirementContent = requirementDocContent.trim()
        const requirementDesc = requirementDescription.trim()
        const hasDoc = Boolean(requirementName && requirementContent)
        const sidOk = Boolean(sid) && regularSpaces.some((s) => s.id === sid)
        if (!sidOk || (!hasDoc && !requirementDesc)) return

        if (sid !== orig.spaceId) {
          const newSpacePath = resolveSpacePath(regularSpaces, sid)
          const ok = await moveTaskToSpace(editingTaskId, sid, newSpacePath)
          if (!ok) return
        }
        updateTaskRequirementDoc(editingTaskId, requirementName, requirementContent, requirementDesc)
      }
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
      // Simple tasks skip the requirement-doc gate
      if (task.taskType !== 'simple') {
        const hasDoc = Boolean(task.requirementDocName?.trim() && task.requirementDocContent?.trim())
        const hasDesc = Boolean(task.requirementDescription?.trim())
        if (!hasDoc && !hasDesc) {
          openEditTaskDialog(task.id)
          return
        }
      }
      const space = spaceById[task.spaceId]
      if (!space) return

      const chatBefore = useChatStore.getState()
      const alreadyOnSpace = chatBefore.currentSpaceId === space.id
      const taskMetaPresent =
        chatBefore
          .getSpaceState(space.id)
          .conversations.some((c) => c.id === task.conversationId)

      setCurrentSpace(space)
      setActiveTask(task.id)
      useChatStore.getState().setCurrentSpace(space.id)

      if (!alreadyOnSpace || !taskMetaPresent) {
        // Refresh space data and load conversation list only when switching spaces
        // or when the conversation metadata isn't cached yet.
        await refreshCurrentSpace()
        await useChatStore.getState().loadConversations(space.id, { silent: true })
      }

      await useChatStore.getState().selectConversation(task.conversationId)
      setView('space')
    },
    [tasks, spaceById, setCurrentSpace, refreshCurrentSpace, setActiveTask, setView, openEditTaskDialog]
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
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <ListTodo className="w-4 h-4" />
          {t('任务管理')}
        </h3>
        <button
          type="button"
          onClick={openCreateDialog}
          className="flex items-center gap-1 px-3 py-1 text-sm text-primary hover:bg-primary/10 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('新建')}
        </button>
      </div>

      {tasks.length === 0 ? (
        <div className="text-sm text-muted-foreground mb-3 space-y-1">
          <p>{t('暂无任务')}</p>
          <p className="text-xs opacity-70">{t('任务管理说明')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          {tasks.slice(0, 5).map((task) => {
            const displayName = spaceNameById[task.spaceId] ?? task.spaceId
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
                    <div className="text-xs mt-1">
                      <span className="text-foreground">{t('空间')}：</span>
                      <span className="text-muted-foreground">
                        {displayName}
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

      {showDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto animate-fade-in">
            <h2 className="text-lg font-medium mb-4">
              {editingTaskId ? t('Edit task') : t('新建任务')}
            </h2>

            {/* Task type selector — at top for new, read-only badge for editing */}
            {editingTaskId ? (
              <div className="mb-4">
                <label className="block text-sm text-muted-foreground mb-2">{t('任务类型')}</label>
                <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm ${
                  taskType === 'simple'
                    ? 'border-blue-500/30 bg-blue-500/8 text-blue-700 dark:text-blue-400'
                    : 'border-violet-500/30 bg-violet-500/8 text-violet-700 dark:text-violet-400'
                }`}>
                  <span>{taskType === 'simple' ? t('简单任务') : t('常规任务')}</span>
                </div>
              </div>
            ) : (
              <div className="mb-4">
                <label className="block text-sm text-muted-foreground mb-2">{t('任务类型')}</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setTaskType('simple')}
                    className={`px-4 py-1.5 rounded-lg text-sm border transition-colors ${
                      taskType === 'simple'
                        ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                        : 'border-border hover:bg-secondary'
                    }`}
                  >
                    {t('简单')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTaskType('complex')}
                    className={`px-4 py-1.5 rounded-lg text-sm border transition-colors ${
                      taskType === 'complex'
                        ? 'border-violet-500 bg-violet-500/10 text-violet-600 dark:text-violet-400'
                        : 'border-border hover:bg-secondary'
                    }`}
                  >
                    {t('复杂')}
                  </button>
                </div>
              </div>
            )}

            {/* ── Simple task form ── */}
            {taskType === 'simple' && (
              <>
                <div className="mb-4">
                  <label className="block text-sm text-muted-foreground mb-2">{t('任务名称')}</label>
                  <input
                    type="text"
                    value={taskName}
                    onChange={(e) => setTaskName(e.target.value)}
                    placeholder={t('自动从目录名生成')}
                    className="w-full px-4 py-2 bg-input rounded-lg border border-border focus:border-primary focus:outline-none transition-colors"
                  />
                </div>
                <div className="mb-4">
                  <label className="block text-sm text-muted-foreground mb-2">{t('项目目录')}</label>
                  {projectDir && (
                    <div className="flex items-center gap-2 mb-2 px-3 py-1.5 rounded-lg bg-primary/5 border border-primary/20 text-sm">
                      <span className="truncate font-mono text-xs">{projectDir}</span>
                      <button
                        type="button"
                        onClick={() => setProjectDir(null)}
                        className="p-0.5 rounded hover:bg-destructive/15 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleSelectProjectDir()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-border hover:border-primary/40 hover:bg-secondary transition-colors text-xs text-muted-foreground"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    {projectDir ? t('更换目录') : t('选择目录')}
                  </button>
                </div>
              </>
            )}

            {/* ── Complex task form ── */}
            {taskType === 'complex' && (
              <>
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

                <div className="mb-4">
                  <label className="block text-sm text-muted-foreground mb-2">{t('Requirement document')}</label>
                  <input
                    ref={requirementInputRef}
                    type="file"
                    multiple
                    accept=".docx,.xlsx,.csv,.txt,.md,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain,text/markdown"
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
                    {isParsingDoc ? t('Processing document...') : t('上传文档')}
                  </button>
                  <div className="mt-2 min-h-6 text-xs text-muted-foreground">
                    {requirementDocName ? (
                      <>
                        <span className="inline-flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{requirementDocName}</span>
                        </span>
                        {requirementDocName.includes(', ') && (
                          <span className="ml-1.5 text-[10px] text-muted-foreground/60">
                            ({requirementDocName.split(', ').length} {t('个文件')})
                          </span>
                        )}
                      </>
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
                    placeholder={t('Describe requirement details when no document is uploaded')}
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

                {editingTaskId && !requirementReady && (
                  <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-foreground">
                    {t(
                      'This task has no requirement document or description. Please provide one before opening the task conversation.'
                    )}
                  </div>
                )}
              </>
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
                  (taskType === 'simple'
                    ? !taskName.trim() || !projectDir
                    : !taskName.trim() || !workspaceValid || !requirementReady || !canPickSpace)
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
