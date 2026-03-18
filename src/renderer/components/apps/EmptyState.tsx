/**
 * EmptyState
 *
 * Shown in the right detail pane when no app is selected,
 * or when there are no installed apps.
 *
 * Supports two modes via `variant`:
 *   - 'automation' (default): messaging for digital humans
 *   - 'apps': messaging for MCP / Skill / Extension apps
 */

import { Blocks, Plus, Store } from 'lucide-react'
import { useTranslation } from '../../i18n'

interface EmptyStateProps {
  hasApps: boolean
  onInstall: () => void
  /** Which tab context this empty state is shown in. Defaults to 'automation'. */
  variant?: 'automation' | 'apps'
}

export function EmptyState({ hasApps, onInstall, variant = 'automation' }: EmptyStateProps) {
  const { t } = useTranslation()

  const isApps = variant === 'apps'
  const selectText = isApps
    ? t('Select an app to view details')
    : t('Select a digital human to view details')
  const selectHint = isApps
    ? t('Choose an app to view details')
    : t('Choose a digital human to view details')
  const emptyTitle = isApps
    ? t('No apps installed yet')
    : t('No digital humans yet')
  const emptyHint = isApps
    ? t('Browse the App Store to find and install apps')
    : t('Create your first digital human from a conversation')
  const actionLabel = isApps
    ? t('Browse App Store')
    : t('Create Digital Human')
  const ActionIcon = isApps ? Store : Plus

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center">
        <Blocks className="w-6 h-6 text-muted-foreground" />
      </div>

      {hasApps ? (
        <div>
          <p className="text-sm font-medium text-foreground">{selectText}</p>
          <p className="text-xs text-muted-foreground mt-1">{selectHint}</p>
        </div>
      ) : (
        <>
          <div>
            <p className="text-sm font-medium text-foreground">{emptyTitle}</p>
            <p className="text-xs text-muted-foreground mt-1">{emptyHint}</p>
          </div>
          <button
            onClick={onInstall}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            <ActionIcon className="w-4 h-4" />
            {actionLabel}
          </button>
        </>
      )}
    </div>
  )
}
