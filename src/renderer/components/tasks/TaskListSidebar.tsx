/**
 * Left sidebar in task-focus mode: lists all workspace tasks (newest created first), switch + exit.
 */

import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react'
import { ListTodo, ChevronLeft } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useChatStore } from '../../stores/chat.store'
import { useSpaceStore } from '../../stores/space.store'
import { useAppStore } from '../../stores/app.store'
import { useTaskStore } from '../../stores/task.store'
import type { WorkspaceTask } from '../../types'

const MIN_WIDTH = 140
const MAX_WIDTH = 360
const DEFAULT_WIDTH = 260
const clampWidth = (v: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, v))

interface TaskListSidebarProps {
  onClose?: () => void
  visible?: boolean
}

export const TaskListSidebar = memo(function TaskListSidebar({
  onClose,
  visible = true,
}: TaskListSidebarProps) {
  const { t } = useTranslation()
  const setView = useAppStore((s) => s.setView)
  const devxSpace = useSpaceStore((s) => s.devxSpace)
  const spaces = useSpaceStore((s) => s.spaces)
  const layoutConfig = useAppStore((s) => s.config?.layout)
  const initialWidth = layoutConfig?.sidebarWidth
  const [width, setWidth] = useState(initialWidth != null ? clampWidth(initialWidth) : DEFAULT_WIDTH)
  const [isDragging, setIsDragging] = useState(false)
  const widthRef = useRef(width)
  const containerRef = useRef<HTMLDivElement>(null)

  const allTasks = useTaskStore((s) => s.tasks)
  const activeTaskId = useTaskStore((s) => s.activeTaskId)
  const setActiveTask = useTaskStore((s) => s.setActiveTask)
  const clearActiveTask = useTaskStore((s) => s.clearActiveTask)
  const setPendingRequirementTask = useTaskStore((s) => s.setPendingRequirementTask)

  const spaceNameById = useMemo(() => {
    const m: Record<string, string> = {}
    if (devxSpace) m[devxSpace.id] = devxSpace.isTemp ? t('DevX') : devxSpace.name
    for (const s of spaces) m[s.id] = s.name
    return m
  }, [devxSpace, spaces, t])

  const displayTasks = useMemo(() => {
    return [...allTasks].sort((a, b) => {
      const ca = typeof a.createdAt === 'number' ? a.createdAt : a.updatedAt
      const cb = typeof b.createdAt === 'number' ? b.createdAt : b.updatedAt
      return cb - ca
    })
  }, [allTasks])

  useEffect(() => {
    if (initialWidth !== undefined && !isDragging) {
      const c = clampWidth(initialWidth)
      setWidth(c)
      widthRef.current = c
    }
  }, [initialWidth, isDragging])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  useEffect(() => {
    if (!isDragging) return
    const handleMove = (e: MouseEvent) => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const nw = clampWidth(e.clientX - rect.left)
      setWidth(nw)
      widthRef.current = nw
    }
    const handleUp = () => {
      setIsDragging(false)
      const cfg = useAppStore.getState().config
      if (cfg) {
        useAppStore.getState().updateConfig({
          layout: { ...cfg.layout, sidebarWidth: widthRef.current },
        })
      }
    }
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
    return () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
    }
  }, [isDragging])

  const selectTask = useCallback(
    async (task: WorkspaceTask) => {
      const hasDoc = Boolean(task.requirementDocName?.trim() && task.requirementDocContent?.trim())
      const hasDesc = Boolean(task.requirementDescription?.trim())
      if (!hasDoc && !hasDesc) {
        setPendingRequirementTask(task.id)
        clearActiveTask()
        setView('home')
        return
      }
      const spaceList = [...(devxSpace ? [devxSpace] : []), ...spaces]
      const space = spaceList.find((s) => s.id === task.spaceId)
      if (!space) return

      const chatBefore = useChatStore.getState()
      const alreadyOnSpace = chatBefore.currentSpaceId === space.id
      const taskMetaPresent =
        chatBefore
          .getSpaceState(space.id)
          .conversations.some((c) => c.id === task.conversationId)

      // Before any await: align space + active task so SpacePage initSpace sees correct focusTask
      // (otherwise initSpace may pick the first conversation and flash the wrong session).
      useSpaceStore.getState().setCurrentSpace(space)
      setActiveTask(task.id)
      useChatStore.getState().setCurrentSpace(space.id)

      await useSpaceStore.getState().refreshCurrentSpace()

      if (!alreadyOnSpace || !taskMetaPresent) {
        await useChatStore.getState().loadConversations(space.id, { silent: true })
      }

      await useChatStore.getState().selectConversation(task.conversationId)
    },
    [devxSpace, spaces, setActiveTask, setPendingRequirementTask, clearActiveTask, setView]
  )

  return (
    <div
      ref={containerRef}
      className="border-r border-border flex flex-col bg-card/50 relative"
      style={{ width, transition: isDragging ? 'none' : 'width 0.2s ease' }}
    >
      <div className="p-3 border-b border-border flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <ListTodo className="w-4 h-4" />
          {t('任务')}
        </span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="relative p-1 hover:bg-secondary rounded-md transition-colors text-muted-foreground hover:text-foreground before:content-[''] before:absolute before:-inset-2"
            title={t('Close sidebar')}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {visible &&
          displayTasks.map((task) => {
            const selected = task.id === activeTaskId
            return (
              <button
                key={task.id}
                type="button"
                onClick={() => void selectTask(task)}
                className={`w-full text-left px-3 py-2.5 border-b border-border/50 transition-colors ${
                  selected ? 'bg-primary/10 border-l-2 border-l-primary pl-[10px]' : 'hover:bg-secondary/60 border-l-2 border-l-transparent'
                }`}
              >
                <div className="text-sm font-medium truncate">{task.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5 truncate">
                  {t('工作空间')}：{spaceNameById[task.spaceId] ?? task.spaceId}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                  {t('Requirement document')}：
                  {task.requirementDocName || (task.requirementDescription ? t('Requirement description') : t('无'))}
                </div>
              </button>
            )
          })}
        {visible && displayTasks.length === 0 && (
          <p className="p-3 text-xs text-muted-foreground">{t('暂无任务')}</p>
        )}
      </div>

      <div className="p-2 border-t border-border">
        <button
          type="button"
          onClick={() => {
            clearActiveTask()
            setView('home')
          }}
          className="w-full px-3 py-2 text-sm text-muted-foreground hover:bg-secondary rounded-lg transition-colors"
        >
          {t('Back to home')}
        </button>
      </div>

      <div
        className={`absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/50 transition-colors z-20 ${
          isDragging ? 'bg-primary/50' : ''
        }`}
        onMouseDown={handleMouseDown}
        title={t('Drag to resize width')}
      />
    </div>
  )
})
