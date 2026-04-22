/**
 * AnnounceFileChangesCard - Shows planned file modifications for user confirmation
 *
 * Displays a list of files the agent plans to modify, with reasons.
 * User confirms once to allow all edits, or cancels to abort.
 * Hidden after confirmed; shows cancelled state when cancelled.
 */

import { useCallback, useRef, useEffect } from 'react'
import { Check, X, FileEdit } from 'lucide-react'
import type { PendingFileChanges } from '../../types'

interface AnnounceFileChangesCardProps {
  pendingFileChanges: PendingFileChanges
  onConfirm: (confirmed: boolean) => void
}

export function AnnounceFileChangesCard({ pendingFileChanges, onConfirm }: AnnounceFileChangesCardProps) {
  const { files, status } = pendingFileChanges

  const handleConfirm = useCallback(() => {
    if (status !== 'active') return
    onConfirm(true)
  }, [status, onConfirm])

  const handleCancel = useCallback(() => {
    if (status !== 'active') return
    onConfirm(false)
  }, [status, onConfirm])

  // Auto-scroll into view when card mounts
  const cardRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (status === 'active') {
      cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [status])

  // Don't render after confirmed
  if (status === 'confirmed') return null

  const isCancelled = status === 'cancelled'
  const isActive = status === 'active'

  return (
    <div
      ref={cardRef}
      className={`
        announce-file-changes-card mt-3 rounded-xl border overflow-hidden
        transition-all duration-300
        ${isCancelled
          ? 'border-border/50 bg-card/30 opacity-50'
          : 'border-amber-500/40 bg-gradient-to-br from-amber-500/5 via-background to-amber-500/3 animate-fade-in'
        }
      `}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/30">
        <FileEdit
          size={16}
          className={isCancelled ? 'text-muted-foreground' : 'text-amber-500'}
        />
        <span className="text-xs font-medium text-muted-foreground">
          {isCancelled ? 'Cancelled' : 'Confirm file modifications'}
        </span>
        {isCancelled && (
          <X size={14} className="text-muted-foreground/50 ml-auto" />
        )}
      </div>

      {/* File list */}
      <div className="px-4 py-3 space-y-1.5">
        <p className="text-xs text-muted-foreground mb-2">
          {isCancelled
            ? `${files.length} file${files.length !== 1 ? 's' : ''} — cancelled`
            : `The agent plans to modify ${files.length} file${files.length !== 1 ? 's' : ''}:`
          }
        </p>
        {files.map((file, idx) => (
          <div
            key={idx}
            className={`
              flex items-start gap-2.5 px-3 py-2 rounded-lg border
              ${isCancelled
                ? 'border-border/30 bg-transparent'
                : 'border-border/40 bg-card/40'
              }
            `}
          >
            <div className={`
              mt-0.5 flex-shrink-0 w-1.5 h-1.5 rounded-full
              ${isCancelled ? 'bg-muted-foreground/30' : 'bg-amber-500/70'}
            `} />
            <div className="flex-1 min-w-0">
              <div className={`text-sm font-mono font-medium truncate ${isCancelled ? 'text-muted-foreground/50' : 'text-foreground'}`}>
                {file.path}
              </div>
              {file.reason && (
                <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                  {file.reason}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Action buttons */}
      {isActive && (
        <div className="px-4 py-3 border-t border-border/30 flex items-center justify-end gap-2">
          <button
            onClick={handleCancel}
            className="
              flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium
              border border-border/50 bg-transparent text-muted-foreground
              hover:bg-muted/20 hover:text-foreground
              transition-all duration-200 active:scale-[0.98]
            "
          >
            <X size={14} />
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="
              flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium
              bg-amber-500 text-white hover:bg-amber-500/90
              transition-all duration-200 active:scale-[0.98]
            "
          >
            <Check size={14} />
            Confirm
          </button>
        </div>
      )}
    </div>
  )
}
