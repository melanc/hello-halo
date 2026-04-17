/**
 * ContextMenu - Lightweight right-click context menu component
 * Zero dependencies, uses Portal for rendering
 * Supports optional one-level submenus (e.g. Git → Status / Stage / …)
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight } from 'lucide-react'

// Menu dimension constants (must match CSS styles)
const MENU_WIDTH = 200
const SUBMENU_MIN_WIDTH = 176
const MENU_ITEM_HEIGHT = 32
const MENU_PADDING = 8
const SUBMENU_CLOSE_DELAY_MS = 180

export interface ContextMenuChildItem {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  separator?: boolean
  hidden?: boolean
}

export interface ContextMenuItem {
  label: string
  icon?: React.ReactNode
  /** Ignored when `children` is set. */
  onClick?: () => void
  children?: ContextMenuChildItem[]
  separator?: boolean
  hidden?: boolean
}

interface ContextMenuProps {
  children: React.ReactNode
  items: ContextMenuItem[]
  className?: string
}

export function ContextMenu({ children, items, className }: ContextMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [openSubmenuIndex, setOpenSubmenuIndex] = useState<number | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const submenuCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearSubmenuTimer = useCallback(() => {
    if (submenuCloseTimer.current) {
      clearTimeout(submenuCloseTimer.current)
      submenuCloseTimer.current = null
    }
  }, [])

  const scheduleCloseSubmenu = useCallback(() => {
    clearSubmenuTimer()
    submenuCloseTimer.current = setTimeout(() => {
      setOpenSubmenuIndex(null)
      submenuCloseTimer.current = null
    }, SUBMENU_CLOSE_DELAY_MS)
  }, [clearSubmenuTimer])

  const openSubmenu = useCallback(
    (index: number) => {
      clearSubmenuTimer()
      setOpenSubmenuIndex(index)
    },
    [clearSubmenuTimer]
  )

  // Handle right-click event
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const { clientX, clientY } = e
    const visibleItems = items.filter(item => !item.hidden)
    const menuHeight = visibleItems.length * MENU_ITEM_HEIGHT + MENU_PADDING

    // Calculate menu position, avoid overflow
    let x = clientX
    let y = clientY

    if (x + MENU_WIDTH > window.innerWidth) {
      x = window.innerWidth - MENU_WIDTH - 8
    }

    if (y + menuHeight > window.innerHeight) {
      y = window.innerHeight - menuHeight - 8
    }

    setPosition({ x, y })
    setOpenSubmenuIndex(null)
    setIsOpen(true)
  }

  // Click outside to close menu
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }

    const handleScroll = () => setIsOpen(false)

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('wheel', handleScroll, { passive: true })

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('wheel', handleScroll)
    }
  }, [isOpen])

  // ESC key to close menu
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) {
      setOpenSubmenuIndex(null)
      clearSubmenuTimer()
    }
  }, [isOpen, clearSubmenuTimer])

  useEffect(() => () => clearSubmenuTimer(), [clearSubmenuTimer])

  const handleLeafClick = (onClick: () => void) => {
    onClick()
    setIsOpen(false)
  }

  const visibleItems = items.filter(item => !item.hidden)

  return (
    <>
      <div className={className} onContextMenu={handleContextMenu}>{children}</div>

      {isOpen &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-50 min-w-[180px] rounded-md border border-border bg-popover p-1 shadow-lg"
            style={{ left: position.x, top: position.y }}
          >
            {visibleItems.map((item, index) => {
              if (item.separator) {
                return <div key={index} className="my-1 h-px bg-border" />
              }

              const childList = item.children?.filter(c => !c.hidden) ?? []

              if (childList.length > 0) {
                const isSubOpen = openSubmenuIndex === index
                const flip =
                  position.x + MENU_WIDTH + SUBMENU_MIN_WIDTH > window.innerWidth - 8
                return (
                  <div
                    key={index}
                    className="relative"
                    onMouseEnter={() => openSubmenu(index)}
                    onMouseLeave={scheduleCloseSubmenu}
                  >
                    <button
                      type="button"
                      className="flex w-full cursor-default items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-secondary/60"
                      onClick={e => {
                        e.preventDefault()
                        e.stopPropagation()
                        openSubmenu(index)
                      }}
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        {item.icon && <span className="w-4 h-4 shrink-0">{item.icon}</span>}
                        <span className="truncate">{item.label}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                    {isSubOpen && (
                      <div
                        className={`absolute top-0 z-[60] min-w-[160px] rounded-md border border-border bg-popover p-1 shadow-lg ${
                          flip ? 'right-full mr-0.5' : 'left-full ml-0.5'
                        }`}
                        onMouseEnter={clearSubmenuTimer}
                        onMouseLeave={scheduleCloseSubmenu}
                      >
                        {childList.map((child, ci) => {
                          if (child.separator) {
                            return <div key={ci} className="my-1 h-px bg-border" />
                          }
                          return (
                            <button
                              key={ci}
                              type="button"
                              onClick={() => handleLeafClick(child.onClick)}
                              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary/60"
                            >
                              {child.icon && <span className="w-4 h-4 shrink-0">{child.icon}</span>}
                              <span className="truncate">{child.label}</span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              }

              return (
                <button
                  key={index}
                  type="button"
                  onClick={() => item.onClick && handleLeafClick(item.onClick)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary/60"
                >
                  {item.icon && <span className="w-4 h-4">{item.icon}</span>}
                  <span>{item.label}</span>
                </button>
              )
            })}
          </div>,
          document.body
        )}
    </>
  )
}
