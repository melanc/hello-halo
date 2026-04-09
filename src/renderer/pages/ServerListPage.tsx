/**
 * ServerListPage - Multi-server management for Capacitor mobile app.
 *
 * Shows all saved Halo desktop servers. The user can:
 * - Tap a server card to connect
 * - Add a new server (navigates to ServerConnect)
 * - Swipe/delete a server
 *
 * This page is only shown in Capacitor mode.
 */

import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Monitor, Wifi, WifiOff, Loader2 } from 'lucide-react'
import { useServerStore } from '../stores/server.store'
import type { ServerEntry } from '../stores/server.store'
import { useAppStore } from '../stores/app.store'
import { api } from '../api'
import { setAuthToken } from '../api/transport'
import { useTranslation } from '../i18n'

type ServerStatus = 'checking' | 'online' | 'offline'

interface ServerCardProps {
  server: ServerEntry
  status: ServerStatus
  onConnect: (server: ServerEntry) => void
  onDelete: (id: string) => void
}

function ServerCard({ server, status, onConnect, onDelete }: ServerCardProps) {
  const { t } = useTranslation()
  const [showDelete, setShowDelete] = useState(false)
  const [touchStartX, setTouchStartX] = useState(0)

  // Swipe-to-reveal delete
  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStartX(e.touches[0].clientX)
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    const diff = touchStartX - e.changedTouches[0].clientX
    if (diff > 80) {
      setShowDelete(true)
    } else if (diff < -40) {
      setShowDelete(false)
    }
  }

  // Extract display URL (without protocol)
  const displayUrl = server.url.replace(/^https?:\/\//, '')

  return (
    <div className="relative overflow-hidden rounded-xl">
      {/* Delete button (revealed by swipe) */}
      <div
        className={`absolute inset-y-0 right-0 flex items-center transition-all duration-200 ${
          showDelete ? 'w-20 opacity-100' : 'w-0 opacity-0'
        }`}
      >
        <button
          onClick={() => onDelete(server.id)}
          className="w-full h-full flex items-center justify-center bg-destructive text-destructive-foreground"
        >
          <Trash2 className="w-5 h-5" />
        </button>
      </div>

      {/* Card content */}
      <button
        onClick={() => {
          if (showDelete) {
            setShowDelete(false)
            return
          }
          onConnect(server)
        }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className={`relative w-full flex items-center gap-4 p-4 bg-card border border-border rounded-xl text-left transition-all duration-200 active:scale-[0.98] ${
          showDelete ? '-translate-x-20' : 'translate-x-0'
        }`}
      >
        {/* Server icon */}
        <div className="flex-shrink-0 w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
          <Monitor className="w-6 h-6 text-primary" />
        </div>

        {/* Server info */}
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-medium text-foreground truncate">
            {server.name}
          </h3>
          <p className="text-sm text-muted-foreground truncate mt-0.5">
            {displayUrl}
          </p>
        </div>

        {/* Status indicator */}
        <div className="flex-shrink-0 flex items-center gap-1.5">
          {status === 'checking' && (
            <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
          )}
          {status === 'online' && (
            <>
              <Wifi className="w-4 h-4 text-devx-success" />
              <span className="text-xs text-devx-success">{t('Online')}</span>
            </>
          )}
          {status === 'offline' && (
            <>
              <WifiOff className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{t('Offline')}</span>
            </>
          )}
        </div>
      </button>
    </div>
  )
}

interface ServerListPageProps {
  /** Called when user taps a server and successfully connects */
  onServerSelected: (server: ServerEntry) => void
  /** Called when user wants to add a new server */
  onAddServer: () => void
}

/** Pending deletion — drives the custom confirm dialog */
interface DeleteConfirm {
  id: string
  name: string
}

export function ServerListPage({ onServerSelected, onAddServer }: ServerListPageProps) {
  const { t } = useTranslation()
  const { servers, removeServer, setActive } = useServerStore()
  const [statusMap, setStatusMap] = useState<Record<string, ServerStatus>>({})
  const [connectingId, setConnectingId] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirm | null>(null)

  // Check server status on mount
  useEffect(() => {
    const checkServers = async () => {
      const initial: Record<string, ServerStatus> = {}
      for (const s of servers) {
        initial[s.id] = 'checking'
      }
      setStatusMap(initial)

      // Check all servers in parallel
      await Promise.all(
        servers.map(async (server) => {
          try {
            const response = await fetch(`${server.url}/api/remote/status`, {
              method: 'GET',
              signal: AbortSignal.timeout(5000)
            })
            setStatusMap(prev => ({
              ...prev,
              [server.id]: response.ok ? 'online' : 'offline'
            }))
          } catch {
            setStatusMap(prev => ({
              ...prev,
              [server.id]: 'offline'
            }))
          }
        })
      )
    }

    if (servers.length > 0) {
      checkServers()
    }
  }, [servers])

  // Handle server selection — activate, set token, connect WS, then navigate
  const handleConnect = useCallback(async (server: ServerEntry) => {
    if (connectingId) return // prevent double-tap
    setConnectingId(server.id)

    console.log(`[ServerList] Connecting to: ${server.name} (${server.url})`)

    try {
      // Set as active in store
      setActive(server.id)

      // Set auth token for HTTP requests
      setAuthToken(server.token)

      // Disconnect existing WebSocket if any
      api.disconnectWebSocket()

      // Connect WebSocket to the selected server
      api.connectWebSocket()

      // Notify parent to proceed with initialization
      onServerSelected(server)
    } finally {
      // Always clear the overlay so the user can retry if navigation throws
      // or the parent keeps the component mounted.
      setConnectingId(null)
    }
  }, [connectingId, setActive, onServerSelected])

  // Open the custom confirm dialog instead of relying on window.confirm()
  const handleDelete = useCallback((id: string) => {
    const server = servers.find(s => s.id === id)
    if (!server) return
    setDeleteConfirm({ id: server.id, name: server.name })
  }, [servers])

  const confirmDelete = useCallback(() => {
    if (!deleteConfirm) return
    removeServer(deleteConfirm.id)
    console.log(`[ServerList] Deleted server: ${deleteConfirm.name}`)
    setDeleteConfirm(null)
  }, [deleteConfirm, removeServer])

  return (
    <div className="h-full w-full flex flex-col bg-background">
      {/* Header with safe area */}
      <div
        className="flex-shrink-0 px-6 pt-4 pb-3 safe-area-top"
        style={{ paddingTop: 'max(16px, var(--sat))' }}
      >
        <h1 className="text-2xl font-semibold text-foreground">
          {t('My Devices')}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t('Select a device to connect')}
        </p>
      </div>

      {/* Server list */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <div className="space-y-3">
          {servers.map(server => (
            <ServerCard
              key={server.id}
              server={server}
              status={statusMap[server.id] || 'checking'}
              onConnect={handleConnect}
              onDelete={handleDelete}
            />
          ))}
        </div>

        {/* Empty state */}
        {servers.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
              <Monitor className="w-8 h-8 text-muted-foreground" />
            </div>
            <p className="text-base text-foreground font-medium">
              {t('No devices yet')}
            </p>
            <p className="text-sm text-muted-foreground mt-1 max-w-[260px]">
              {t('Add your first DevX desktop to get started')}
            </p>
          </div>
        )}
      </div>

      {/* Add server button — fixed at bottom */}
      <div className="flex-shrink-0 px-4 pb-4 safe-area-bottom" style={{ paddingBottom: 'max(16px, var(--sab))' }}>
        <button
          onClick={onAddServer}
          className="w-full py-3.5 rounded-xl bg-primary text-primary-foreground font-medium flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
        >
          <Plus className="w-5 h-5" />
          {t('Add Device')}
        </button>
      </div>

      {/* Connecting overlay */}
      {connectingId && (
        <div className="absolute inset-0 bg-background/80 flex items-center justify-center z-50">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
            <p className="text-sm text-foreground font-medium">
              {t('Connecting...')}
            </p>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deleteConfirm && (
        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 px-6">
          <div className="w-full max-w-sm bg-card border border-border rounded-2xl p-6 shadow-xl">
            <h3 className="text-base font-semibold text-foreground">
              {t('Remove this device?')}
            </h3>
            <p className="text-sm text-muted-foreground mt-1 truncate">
              {deleteConfirm.name}
            </p>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-2.5 rounded-xl border border-border text-foreground text-sm font-medium active:scale-[0.98] transition-transform"
              >
                {t('Cancel')}
              </button>
              <button
                onClick={confirmDelete}
                className="flex-1 py-2.5 rounded-xl bg-destructive text-destructive-foreground text-sm font-medium active:scale-[0.98] transition-transform"
              >
                {t('Remove')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
