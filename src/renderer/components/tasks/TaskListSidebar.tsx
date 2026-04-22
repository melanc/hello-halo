/**
 * Left sidebar in task-focus mode: lists all workspace tasks (newest created first), switch + exit.
 */

import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react'
import { ListTodo, ChevronLeft, Home } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useChatStore } from '../../stores/chat.store'
import { useSpaceStore } from '../../stores/space.store'
import { useAppStore } from '../../stores/app.store'
import { useTaskStore } from '../../stores/task.store'
import type { Space, WorkspaceTask } from '../../types'

function isKnowledgeBaseSpace(s: Space): boolean {
  return s.workspaceKind === 'knowledge_base'
}

const MIN_WIDTH = 140
const MAX_WIDTH = 360
const DEFAULT_WIDTH = 260
const clampWidth = (v: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, v))

// Stage pill: compact label showing which pipeline step the task is currently on
const STAGE_CONFIG = {
  1: { label: '需求', className: 'bg-blue-500/15 text-blue-400' },
  2: { label: '分解', className: 'bg-indigo-500/15 text-indigo-400' },
  3: { label: '规划', className: 'bg-violet-500/15 text-violet-400' },
  4: { label: '编码', className: 'bg-amber-500/15 text-amber-500' },
  5: { label: '验证', className: 'bg-emerald-500/15 text-emerald-400' },
} as const

function StagePill({ stage }: { stage?: number | null }) {
  const cfg = stage != null ? STAGE_CONFIG[stage as keyof typeof STAGE_CONFIG] : null
  if (!cfg) return null
  return (
    <span className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded leading-none ${cfg.className}`}>
      {cfg.label}
    </span>
  )
}

function formatTaskTime(ts: number, now: number): string {
  const date = new Date(ts)
  const today = new Date(now)
  const isToday =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  if (isToday) {
    const diffMin = Math.floor((now - ts) / 60000)
    if (diffMin < 1) return '刚刚'
    if (diffMin < 60) return `${diffMin}分钟前`
    const h = Math.floor(diffMin / 60)
    const m = diffMin % 60
    return m > 0 ? `${h}小时${m}分钟前` : `${h}小时前`
  }
  const mo = date.getMonth() + 1
  const d = date.getDate()
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${mo}.${d} ${hh}:${mm}`
}

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

  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

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
      if (isKnowledgeBaseSpace(space)) {
        setPendingRequirementTask(task.id)
        clearActiveTask()
        setView('home')
        return
      }

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
      {/* Header */}
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          <ListTodo className="w-3.5 h-3.5" />
          {t('任务')}
          {displayTasks.length > 0 && (
            <span className="text-muted-foreground/40 font-normal normal-case tracking-normal">
              {displayTasks.length}
            </span>
          )}
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

      {/* Task list */}
      <div className="flex-1 overflow-y-auto min-h-0 py-1">
        {visible &&
          displayTasks.map((task) => {
            const selected = task.id === activeTaskId
            const spaceName = spaceNameById[task.spaceId] ?? task.spaceId
            const timeLabel = task.updatedAt ? formatTaskTime(task.updatedAt, now) : null
            return (
              <button
                key={task.id}
                type="button"
                onClick={() => void selectTask(task)}
                className={`w-full text-left px-3 py-2.5 transition-all border-l-2 ${
                  selected
                    ? 'bg-primary/10 border-l-primary'
                    : 'border-l-transparent hover:bg-secondary/60 hover:border-l-border'
                }`}
              >
                <div className="flex items-start gap-1.5 mb-1">
                  <div className={`flex-1 min-w-0 text-sm font-medium truncate leading-snug ${selected ? 'text-foreground' : ''}`}>
                    {task.name}
                  </div>
                  <StagePill stage={task.pipelineStage} />
                </div>
                <div className="flex items-center justify-between gap-1 mt-0.5">
                  <div className="text-xs text-muted-foreground/70 truncate">{spaceName}</div>
                  {timeLabel && (
                    <div className="text-[11px] text-muted-foreground/45 shrink-0 tabular-nums">
                      {timeLabel}
                    </div>
                  )}
                </div>
              </button>
            )
          })}
        {visible && displayTasks.length === 0 && (
          <div className="px-3 py-6 text-center">
            <ListTodo className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground/50">{t('暂无任务')}</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-2 border-t border-border">
        <button
          type="button"
          onClick={() => {
            clearActiveTask()
            setView('home')
          }}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
        >
          <Home className="w-3.5 h-3.5" />
          {t('Back to home')}
        </button>
      </div>

      {/* Resize handle */}
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
