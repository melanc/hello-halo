/**
 * Home page — workspace tasks list and create dialog
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { FileText, HelpCircle, ListTodo, Plus, Trash2, Upload } from 'lucide-react'
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

  const [showDialog, setShowDialog] = useState(false)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [taskName, setTaskName] = useState('')
  const [spaceId, setSpaceId] = useState<string>('')
  const [requirementDocName, setRequirementDocName] = useState('')
  const [requirementDocContent, setRequirementDocContent] = useState('')
  const [requirementDescription, setRequirementDescription] = useState('')
  const [isParsingDoc, setIsParsingDoc] = useState(false)
  const [creating, setCreating] = useState(false)
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
    setTaskName('')
    setRequirementDocName('')
    setRequirementDocContent('')
    setRequirementDescription('')
    const first = allSpaces[0]?.id ?? ''
    setSpaceId(first)
    setShowDialog(true)
  }

  const resetDialog = () => {
    setShowDialog(false)
    setEditingTaskId(null)
    setTaskName('')
    setRequirementDocName('')
    setRequirementDocContent('')
    setRequirementDescription('')
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
    const sid = spaceId.trim()
    const requirementName = requirementDocName.trim()
    const requirementContent = requirementDocContent.trim()
    const requirementDesc = requirementDescription.trim()
    const hasDoc = Boolean(requirementName && requirementContent)
    if (!name || !sid || !allSpaces.some((s) => s.id === sid) || (!hasDoc && !requirementDesc)) return
    setCreating(true)
    try {
      const task = await addTask({
        name,
        spaceId: sid,
        requirementDocName: requirementName,
        requirementDocContent: requirementContent,
        requirementDescription: requirementDesc,
        projectDirs: [],
        branchName: '',
      })
      if (task) resetDialog()
    } finally {
      setCreating(false)
    }
  }

  const openEditRequirementDialog = useCallback(
    (taskId: string) => {
      const task = tasks.find((x) => x.id === taskId)
      if (!task) return
      setEditingTaskId(task.id)
      setTaskName(task.name)
      setSpaceId(task.spaceId)
      setRequirementDocName(task.requirementDocName || '')
      setRequirementDocContent(task.requirementDocContent || '')
      setRequirementDescription(task.requirementDescription || '')
      setShowDialog(true)
    },
    [tasks]
  )

  const handleSaveRequirementDoc = () => {
    if (!editingTaskId) return
    const requirementName = requirementDocName.trim()
    const requirementContent = requirementDocContent.trim()
    const requirementDesc = requirementDescription.trim()
    const hasDoc = Boolean(requirementName && requirementContent)
    if (!hasDoc && !requirementDesc) return
    updateTaskRequirementDoc(editingTaskId, requirementName, requirementContent, requirementDesc)
    resetDialog()
  }

  useEffect(() => {
    if (!pendingRequirementTaskId) return
    openEditRequirementDialog(pendingRequirementTaskId)
    clearPendingRequirementTask()
  }, [pendingRequirementTaskId, openEditRequirementDialog, clearPendingRequirementTask])

  const handleOpenTask = useCallback(
    async (taskId: string) => {
      const task = tasks.find((x) => x.id === taskId)
      if (!task) return
      const hasDoc = Boolean(task.requirementDocName?.trim() && task.requirementDocContent?.trim())
      const hasDesc = Boolean(task.requirementDescription?.trim())
      if (!hasDoc && !hasDesc) {
        openEditRequirementDialog(task.id)
        return
      }
      const space = allSpaces.find((s) => s.id === task.spaceId)
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

      await refreshCurrentSpace()

      if (!alreadyOnSpace || !taskMetaPresent) {
        await useChatStore.getState().loadConversations(space.id, { silent: true })
      }

      await useChatStore.getState().selectConversation(task.conversationId)
      setView('space')
    },
    [tasks, allSpaces, setCurrentSpace, refreshCurrentSpace, setActiveTask, setView, openEditRequirementDialog]
  )

  const spaceIdTrimmed = spaceId.trim()
  const workspaceValid =
    Boolean(spaceIdTrimmed) && allSpaces.some((s) => s.id === spaceIdTrimmed)
  const requirementReady =
    (requirementDocName.trim().length > 0 && requirementDocContent.trim().length > 0) ||
    requirementDescription.trim().length > 0

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
          disabled={allSpaces.length === 0}
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
                    <div className="font-medium truncate">{task.name}</div>
                    <div className="text-xs mt-1">
                      <span className="text-foreground">{t('工作空间')}：</span>
                      <span className="text-muted-foreground">
                        {spaceNameById[task.spaceId] ?? task.spaceId}
                      </span>
                    </div>
                    <div className="text-xs mt-1 line-clamp-2">
                      <span className="text-foreground">{t('Requirement document')}：</span>
                      <span className="text-muted-foreground">
                        {task.requirementDocName || (task.requirementDescription ? t('Requirement description') : t('无'))}
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
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleRequestDeleteTask(task.id, task.name)
                    }}
                    className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/15 text-destructive transition-all shrink-0"
                    title={t('Delete')}
                    aria-label={t('Delete')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
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
              {editingTaskId ? t('Edit requirement document') : t('新建任务')}
            </h2>

            <div className="mb-4">
              <label className="block text-sm text-muted-foreground mb-2">{t('任务名称')}</label>
              <input
                type="text"
                value={taskName}
                onChange={(e) => setTaskName(e.target.value)}
                placeholder={t('例如：用户登录迭代')}
                disabled={!!editingTaskId}
                className="w-full px-4 py-2 bg-input rounded-lg border border-border focus:border-primary focus:outline-none transition-colors disabled:opacity-70"
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm text-muted-foreground mb-2">{t('工作空间')}</label>
              <select
                value={spaceId}
                onChange={(e) => setSpaceId(e.target.value)}
                disabled={!!editingTaskId}
                className={`w-full px-4 py-2 bg-input rounded-lg border focus:outline-none transition-colors ${
                  !workspaceValid
                    ? 'border-destructive focus:border-destructive'
                    : 'border-border focus:border-primary'
                } disabled:opacity-70`}
              >
                {allSpaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.isTemp ? t('DevX') : s.name}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {t('A workspace is required.')}
              </p>
            </div>

            {editingTaskId && !requirementReady && (
              <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-foreground">
                {t('This task has no requirement document or description. Please provide one before opening the task conversation.')}
              </div>
            )}

            <div className="mb-6">
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
                onClick={() => void (editingTaskId ? handleSaveRequirementDoc() : handleCreate())}
                disabled={
                  creating ||
                  !taskName.trim() ||
                  !workspaceValid ||
                  !requirementReady
                }
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {editingTaskId ? t('Save requirement document') : t('创建')}
              </button>
            </div>
          </div>
        </div>
      )}
      {DialogComponent}
    </>
  )
}
