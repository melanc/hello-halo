/**
 * Advanced Section Component
 * Developer-level settings: prompt profile, max turns, CLI integration
 */

import { useState, useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { api } from '../../api'
import { isElectron } from '../../api/transport'
import type { DevXConfig } from '../../types'
import { CLIConfigSection } from './CLIConfigSection'

interface AdvancedSectionProps {
  config: DevXConfig | null
  setConfig: (config: DevXConfig) => void
}

export function AdvancedSection({ config, setConfig }: AdvancedSectionProps) {
  const { t } = useTranslation()

  const [maxTurns, setMaxTurnsState] = useState(config?.agent?.maxTurns ?? 50)
  const [promptProfile, setPromptProfileState] = useState<'official' | 'halo'>(
    config?.agent?.promptProfile ?? 'halo'
  )

  const [offlineVoiceEnabled, setOfflineVoiceEnabled] = useState(config?.offlineSpeech?.enabled ?? false)
  const [whisperBinPath, setWhisperBinPath] = useState(config?.offlineSpeech?.whisperBinPath ?? '')
  const [whisperModelPath, setWhisperModelPath] = useState(config?.offlineSpeech?.whisperModelPath ?? '')

  useEffect(() => {
    setOfflineVoiceEnabled(config?.offlineSpeech?.enabled ?? false)
    setWhisperBinPath(config?.offlineSpeech?.whisperBinPath ?? '')
    setWhisperModelPath(config?.offlineSpeech?.whisperModelPath ?? '')
  }, [config?.offlineSpeech?.enabled, config?.offlineSpeech?.whisperBinPath, config?.offlineSpeech?.whisperModelPath])

  const persistOfflineSpeech = async (next: {
    enabled?: boolean
    whisperBinPath?: string
    whisperModelPath?: string
  }) => {
    const offlineSpeech = {
      enabled: next.enabled ?? offlineVoiceEnabled,
      whisperBinPath: next.whisperBinPath ?? whisperBinPath,
      whisperModelPath: next.whisperModelPath ?? whisperModelPath,
    }
    try {
      await api.setConfig({ offlineSpeech })
      setConfig({
        ...config,
        offlineSpeech,
      } as DevXConfig)
    } catch (e) {
      console.error('[AdvancedSection] offlineSpeech save failed', e)
    }
  }

  const handleMaxTurnsChange = async (value: number) => {
    const clamped = Math.max(10, Math.min(9999, value))
    setMaxTurnsState(clamped)
    try {
      const updatedConfig = {
        ...config,
        agent: { ...config?.agent, maxTurns: clamped }
      } as DevXConfig
      await api.setConfig({ agent: updatedConfig.agent })
      setConfig(updatedConfig)
    } catch (error) {
      console.error('[AdvancedSection] Failed to update maxTurns:', error)
      setMaxTurnsState(config?.agent?.maxTurns ?? 50)
    }
  }

  const handlePromptProfileChange = async (profile: 'official' | 'halo') => {
    setPromptProfileState(profile)
    try {
      const updatedConfig = {
        ...config,
        agent: { ...config?.agent, promptProfile: profile }
      } as DevXConfig
      await api.setConfig({ agent: updatedConfig.agent })
      setConfig(updatedConfig)
    } catch (error) {
      console.error('[AdvancedSection] Failed to update promptProfile:', error)
      setPromptProfileState(config?.agent?.promptProfile ?? 'halo')
    }
  }

  return (
    <section id="advanced" className="bg-card rounded-xl border border-border p-6">
      <h2 className="text-lg font-medium mb-4">{t('Advanced')}</h2>

      {/* Warning banner */}
      <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 mb-5 text-sm text-amber-600 dark:text-amber-400">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <span>{t('Changes here affect all AI agent behavior. New settings take effect on the next conversation.')}</span>
      </div>

      <div className="space-y-4">
        {/* System Prompt Profile */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <p className="font-medium">{t('System Prompt Profile')}</p>
          </div>
          <p className="text-sm text-muted-foreground mb-3">
            {t('Choose the system prompt template used by the claude code agent')}
          </p>

          <div className="space-y-2">
            {/* Official */}
            <label className="flex items-start gap-3 p-3 rounded-lg border border-border cursor-pointer hover:bg-muted/50 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5">
              <input
                type="radio"
                name="promptProfile"
                value="official"
                checked={promptProfile === 'official'}
                onChange={() => handlePromptProfileChange('official')}
                className="mt-0.5 accent-primary"
              />
              <div>
                <p className="font-medium text-sm">{t('Official')}</p>
                <p className="text-xs text-muted-foreground">{t('Base prompt without DevX-specific optimizations')}</p>
              </div>
            </label>

            {/* Halo Optimized */}
            <label className="flex items-start gap-3 p-3 rounded-lg border border-border cursor-pointer hover:bg-muted/50 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5">
              <input
                type="radio"
                name="promptProfile"
                value="halo"
                checked={promptProfile === 'halo'}
                onChange={() => handlePromptProfileChange('halo')}
                className="mt-0.5 accent-primary"
              />
              <div>
                <p className="font-medium text-sm">{t('DevX Optimized')}</p>
                <p className="text-xs text-muted-foreground">{t('Includes DevX-specific improvements (Web Research strategy, etc.)')}</p>
              </div>
            </label>
          </div>
        </div>

        {/* Max Turns per Message */}
        <div className="flex items-center justify-between pt-4 border-t border-border">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <p className="font-medium">{t('Max Turns per Message')}</p>
              <span
                className="inline-flex items-center justify-center w-4 h-4 text-xs rounded-full bg-muted text-muted-foreground cursor-help"
                title={t('Maximum number of tool call rounds the AI agent can execute per message')}
              >
                ?
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              {t('Maximum number of tool call rounds the AI agent can execute per message')}
            </p>
          </div>
          <input
            type="number"
            min={10}
            max={9999}
            value={maxTurns}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10)
              if (!isNaN(val)) {
                setMaxTurnsState(val)
              }
            }}
            onBlur={(e) => {
              const val = parseInt(e.target.value, 10)
              if (!isNaN(val)) {
                handleMaxTurnsChange(val)
              }
            }}
            className="w-24 px-3 py-1.5 text-sm bg-secondary border border-border rounded-lg text-right focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        {isElectron() && (
          <div className="pt-4 border-t border-border space-y-3">
            <div>
              <p className="font-medium mb-1">{t('Offline voice input (Whisper)')}</p>
              <p className="text-sm text-muted-foreground mb-3">
                {t(
                  'Use local whisper.cpp for dictation without internet. Install whisper-cli (or main), download a GGML model such as ggml-base.bin, then set paths below. Environment WHISPER_CPP_BIN and WHISPER_CPP_MODEL override paths when set.'
                )}
              </p>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={offlineVoiceEnabled}
                onChange={async (e) => {
                  const v = e.target.checked
                  setOfflineVoiceEnabled(v)
                  await persistOfflineSpeech({ enabled: v })
                }}
                className="rounded border-border"
              />
              <span className="text-sm">{t('Enable offline voice input')}</span>
            </label>
            <div>
              <p className="text-xs text-muted-foreground mb-1">{t('whisper.cpp executable')}</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={whisperBinPath}
                  onChange={(e) => setWhisperBinPath(e.target.value)}
                  onBlur={() => persistOfflineSpeech({ whisperBinPath })}
                  placeholder={t('Path to whisper-cli or main')}
                  className="flex-1 min-w-0 px-3 py-2 text-sm bg-secondary border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <button
                  type="button"
                  onClick={async () => {
                    const r = await api.offlineSpeechBrowseFile({
                      title: t('Select whisper.cpp executable'),
                    })
                    if (r.success && r.data && (r.data as { path?: string | null }).path) {
                      const p = (r.data as { path: string }).path
                      setWhisperBinPath(p)
                      await persistOfflineSpeech({ whisperBinPath: p })
                    }
                  }}
                  className="px-3 py-2 text-sm rounded-lg border border-border bg-secondary hover:bg-muted/50 shrink-0"
                >
                  {t('Browse')}
                </button>
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">{t('GGML model file')}</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={whisperModelPath}
                  onChange={(e) => setWhisperModelPath(e.target.value)}
                  onBlur={() => persistOfflineSpeech({ whisperModelPath })}
                  placeholder={t('Path to ggml-base.bin or other .bin model')}
                  className="flex-1 min-w-0 px-3 py-2 text-sm bg-secondary border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <button
                  type="button"
                  onClick={async () => {
                    const r = await api.offlineSpeechBrowseFile({
                      title: t('Select GGML model file'),
                      filters: [{ name: 'GGML', extensions: ['bin'] }, { name: 'All Files', extensions: ['*'] }],
                    })
                    if (r.success && r.data && (r.data as { path?: string | null }).path) {
                      const p = (r.data as { path: string }).path
                      setWhisperModelPath(p)
                      await persistOfflineSpeech({ whisperModelPath: p })
                    }
                  }}
                  className="px-3 py-2 text-sm rounded-lg border border-border bg-secondary hover:bg-muted/50 shrink-0"
                >
                  {t('Browse')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Claude CLI Integration */}
        <CLIConfigSection />
      </div>
    </section>
  )
}
