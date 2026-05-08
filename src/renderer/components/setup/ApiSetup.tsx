/**
 * API Setup - Custom API configuration
 * No validation - just save and enter, errors will show on first chat
 * Includes language selector for first-time users
 * Now supports back button for multi-source login flow
 */

import { useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useAppStore } from '../../stores/app.store'
import { api } from '../../api'
import { Lightbulb, CheckCircle2, XCircle } from '../icons/ToolIcons'
import { Globe, ChevronDown, ArrowLeft, Eye, EyeOff, Loader2, RefreshCw } from 'lucide-react'
import { AVAILABLE_MODELS, DEFAULT_MODEL, type AISourcesConfig, type AISource, type ProviderId } from '../../types'
import { getBuiltinProvider, getApiKeyProviders, isAnthropicProvider } from '../../types'
import { useTranslation, setLanguage, getCurrentLanguage, SUPPORTED_LOCALES, type LocaleCode } from '../../i18n'

interface ApiSetupProps {
  /** Called when user clicks back button */
  onBack?: () => void
  /** Whether to show the back button */
  showBack?: boolean
}

export function ApiSetup({ onBack, showBack = false }: ApiSetupProps) {
  const { t } = useTranslation()
  const { config, setConfig, setView } = useAppStore()

  // Form state
  const [provider, setProvider] = useState(config?.api.provider || 'anthropic')
  const [apiKey, setApiKey] = useState(config?.api.apiKey || '')
  const [apiUrl, setApiUrl] = useState(config?.api.apiUrl || 'https://api.anthropic.com')
  const [model, setModel] = useState(config?.api.model || DEFAULT_MODEL)
  const [isValidating, setIsValidating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Validation result state
  const [validationResult, setValidationResult] = useState<{
    valid: boolean
    message?: string
  } | null>(null)
  // Custom model toggle
  const [useCustomModel, setUseCustomModel] = useState(() => {
    const currentModel = config?.api.model || DEFAULT_MODEL
    return !AVAILABLE_MODELS.some(m => m.id === currentModel)
  })

  // Model fetching state
  const [fetchedModels, setFetchedModels] = useState<string[]>(
    (config?.api.availableModels as string[]) || []
  )
  const [isFetchingModels, setIsFetchingModels] = useState(false)

  // Language selector state
  const [isLangDropdownOpen, setIsLangDropdownOpen] = useState(false)
  const [currentLang, setCurrentLang] = useState<LocaleCode>(getCurrentLanguage())
  // API Key visibility
  const [showApiKey, setShowApiKey] = useState(false)

  // Handle language change
  const handleLanguageChange = (lang: LocaleCode) => {
    setLanguage(lang)
    setCurrentLang(lang)
    setIsLangDropdownOpen(false)
  }

  const allProviders = getApiKeyProviders()
  const recommendedProviders = allProviders.filter(p => p.recommended)
  const cnProviders = allProviders.filter(p => !p.recommended && p.region === 'cn')
  const globalProviders = allProviders.filter(p => !p.recommended && p.region === 'global')

  const handleProviderChange = (next: string) => {
    setProvider(next as ProviderId)
    setError(null)
    setFetchedModels([])

    const providerConfig = getBuiltinProvider(next as ProviderId)
    if (!providerConfig) return

    // Set API URL from provider config
    setApiUrl(providerConfig.apiUrl)

    // Set model from provider config
    if (providerConfig.models.length > 0) {
      setModel(providerConfig.models[0].id)
      setUseCustomModel(false)
    } else {
      // openai (protocol entry) has empty models, keep text input
      if (next === 'openai') {
        setModel('gpt-4o-mini')
      }
    }
  }

  // Fetch models from custom API
  const fetchModels = async () => {
    if (!apiUrl) {
      setError(t('Please enter API URL first'))
      return
    }
    if (!apiKey) {
      setError(t('Please enter API Key first'))
      return
    }

    setIsFetchingModels(true)
    setError(null)

    try {
      // Construct models endpoint
      let baseUrl = apiUrl
      if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1)

      // Remove /chat/completions suffix if present (common mistake)
      if (baseUrl.endsWith('/chat/completions')) {
        baseUrl = baseUrl.replace(/\/chat\/completions$/, '')
      }

      const url = `${baseUrl}/models`

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch models (${response.status})`)
      }

      const data = await response.json()

      // OpenAI compatible format: { data: [{ id: 'model-id', ... }] }
      if (data.data && Array.isArray(data.data)) {
        const models = data.data
          .map((m: any) => m.id)
          .filter((id: any) => typeof id === 'string')
          .sort()

        if (models.length === 0) {
          throw new Error('No models found in response')
        }

        setFetchedModels(models)

        // If current model is not in list (and we found models), select the first one?
        // Or just let user decide.
        // If current model is default generic one, maybe switch to first fetched.
        if (models.length > 0 && (!model || model === 'gpt-4o-mini' || model === 'deepseek-chat' || model === 'deepseek-v4-flash')) {
          setModel(models[0])
        }
      } else {
        throw new Error('Invalid API response format (expected data array)')
      }
    } catch {
      setError(t('Failed to fetch models. Check URL and Key.'))
    } finally {
      setIsFetchingModels(false)
    }
  }

  // Handle save and enter - save directly without mandatory validation
  const handleSaveAndEnter = async () => {
    if (!apiKey.trim()) {
      setError(t('Please enter API Key'))
      return
    }

    setError(null)

    try {
      const effectiveApiUrl = apiUrl || 'https://api.anthropic.com'
      const now = new Date().toISOString()

      // Build v2 AISource
      const providerType = provider as ProviderId
      const builtin = getBuiltinProvider(providerType)

      const newSource: AISource = {
        id: uuidv4(),
        name: builtin?.name || 'Custom API',
        provider: providerType,
        authType: 'api-key',
        apiUrl: effectiveApiUrl,
        apiType: builtin?.apiType,
        apiKey,
        model,
        availableModels: fetchedModels.length > 0
          ? fetchedModels.map(id => ({ id, name: id }))
          : builtin?.models || [{ id: model, name: model }],
        createdAt: now,
        updatedAt: now
      }

      // Build v2 aiSources config
      const newAiSources: AISourcesConfig = {
        version: 2,
        currentId: newSource.id,
        sources: [newSource]
      }

      const newConfig = {
        ...config,
        // Legacy api field for backward compatibility
        api: {
          provider: providerType,
          apiKey,
          apiUrl: effectiveApiUrl,
          model,
          availableModels: fetchedModels
        },
        // v2 aiSources structure
        aiSources: newAiSources,
        isFirstLaunch: false
      }

      await api.setConfig(newConfig)
      setConfig(newConfig as any)

      // Enter Halo
      setView('home')
    } catch {
      setError(t('Save failed'))
    }
  }

  // Optional: test API connection without blocking save
  const handleTestConnection = async () => {
    if (!apiKey.trim()) {
      setError(t('Please enter API Key'))
      return
    }

    setIsValidating(true)
    setError(null)
    setValidationResult(null)

    try {
      const effectiveApiUrl = apiUrl || 'https://api.anthropic.com'
      const currentProviderConfig = getBuiltinProvider(provider as ProviderId)
      const isAnthropicCompat = isAnthropicProvider(provider as ProviderId) || currentProviderConfig?.apiType === 'anthropic_passthrough'
      const result = await api.validateApi(apiKey, effectiveApiUrl, isAnthropicCompat ? 'anthropic' : 'openai', model)

      if (!result.success || !result.data?.valid) {
        setValidationResult({
          valid: false,
          message: result.data?.message || result.error || t('Connection failed')
        })
      } else {
        // Auto-correct URL if backend normalized it
        const normalizedUrl = result.data.normalizedUrl || effectiveApiUrl
        if (normalizedUrl !== apiUrl) {
          setApiUrl(normalizedUrl)
        }
        setValidationResult({ valid: true, message: t('Connection successful') })
      }
    } catch {
      setValidationResult({
        valid: false,
        message: t('Connection failed')
      })
    } finally {
      setIsValidating(false)
    }
  }

  return (
    <div className="h-full w-full flex flex-col items-center justify-center bg-background p-8 relative overflow-auto">
      {/* Language Selector - Top Right */}
      <div className="absolute top-6 right-6">
        <div className="relative">
          <button
            onClick={() => setIsLangDropdownOpen(!isLangDropdownOpen)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/80 rounded-lg transition-colors"
          >
            <Globe className="w-4 h-4" />
            <span>{SUPPORTED_LOCALES[currentLang]}</span>
            <ChevronDown className={`w-4 h-4 transition-transform ${isLangDropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {/* Dropdown */}
          {isLangDropdownOpen && (
            <>
              {/* Backdrop to close dropdown */}
              <div
                className="fixed inset-0 z-10"
                onClick={() => setIsLangDropdownOpen(false)}
              />
              <div className="absolute right-0 mt-1 py-1 w-40 bg-card border border-border rounded-lg shadow-lg z-20">
                {Object.entries(SUPPORTED_LOCALES).map(([code, name]) => (
                  <button
                    key={code}
                    onClick={() => handleLanguageChange(code as LocaleCode)}
                    className={`w-full px-4 py-2 text-left text-sm hover:bg-secondary/80 transition-colors ${currentLang === code ? 'text-primary font-medium' : 'text-foreground'
                      }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Header */}
      <div className="flex flex-col items-center mb-8">
        {/* Logo */}
        <div className="w-16 h-16 rounded-full border-2 border-primary/60 flex items-center justify-center devx-glow">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary/30 to-transparent" />
        </div>
        <h1 className="mt-4 text-2xl font-light">{t('DevX')}</h1>
      </div>

      {/* Main content */}
      <div className="w-full max-w-md">
        <div className="relative mb-6">
          {/* Back Button - inline left of title */}
          {showBack && onBack && (
            <button
              onClick={onBack}
              className="absolute left-0 top-1/2 -translate-y-1/2 flex items-center gap-1.5 px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/80 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>{t('Back')}</span>
            </button>
          )}
          <h2 className="text-center text-lg">
            {showBack ? t('Configure Custom API') : t('Before you start, configure your AI')}
          </h2>
        </div>

        <div className="bg-card rounded-xl p-6 border border-border">
          {/* Provider */}
          <div className="mb-4">
            <label className="block text-sm text-muted-foreground mb-2">{t('Provider')}</label>
            <div className="relative">
              <div className="w-full bg-input rounded-lg border border-border">
                {/* Current provider display */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 p-3">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <span className="text-sm font-bold text-primary">
                        {(getBuiltinProvider(provider as ProviderId)?.name || provider).charAt(0)}
                      </span>
                    </div>
                    <div>
                      <p className="font-medium text-sm text-foreground">
                        {getBuiltinProvider(provider as ProviderId)?.name || provider}
                      </p>
                      {getBuiltinProvider(provider as ProviderId)?.description && (
                        <p className="text-xs text-muted-foreground">
                          {getBuiltinProvider(provider as ProviderId)?.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <select
                    value={provider}
                    onChange={(e) => handleProviderChange(e.target.value)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  >
                    <optgroup label={t('Recommended')}>
                      {recommendedProviders.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </optgroup>
                    <optgroup label={t('China Region')}>
                      {cnProviders.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </optgroup>
                    <optgroup label={t('Global Providers')}>
                      {globalProviders.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </optgroup>
                  </select>
                  {/* Chevron overlay */}
                  <div className="pr-3 pointer-events-none text-muted-foreground">
                    <ChevronDown className="w-5 h-5" />
                  </div>
                </div>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {getBuiltinProvider(provider as ProviderId)?.notes || ''}
              </p>
            </div>
          </div>

          {/* API Key input */}
          <div className="mb-4">
            <label className="block text-sm text-muted-foreground mb-2">API Key</label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={provider === 'openai' ? 'sk-xxxxxxxxxxxxx' : 'sk-ant-xxxxxxxxxxxxx'}
                className="w-full px-4 py-2 pr-12 bg-input rounded-lg border border-border focus:border-primary focus:outline-none transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* API URL input */}
          <div className="mb-6">
            <label className="block text-sm text-muted-foreground mb-2">{t('API URL (optional)')}</label>
            <input
              type="text"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder={provider === 'openai' ? 'https://api.openai.com or https://xx/v1' : 'https://api.anthropic.com'}
              className="w-full px-4 py-2 bg-input rounded-lg border border-border focus:border-primary focus:outline-none transition-colors"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {provider === 'openai'
                ? t('Enter OpenAI compatible service URL (supports /v1/chat/completions)')
                : t('Default official URL, modify for custom proxy')}
            </p>
          </div>

          {/* Model */}
          <div className="mb-2">
            <label className="block text-sm text-muted-foreground mb-2">{t('Model')}</label>

            {/* Get current provider's models */}
            {(() => {
              const currentProviderConfig = getBuiltinProvider(provider as ProviderId)
              const hasBuiltinModels = currentProviderConfig && currentProviderConfig.models.length > 0

              // Anthropic: show Claude model list or custom input
              if (provider === 'anthropic' || (currentProviderConfig?.apiType === 'anthropic_passthrough' && hasBuiltinModels)) {
                const modelsToShow = currentProviderConfig?.models || AVAILABLE_MODELS
                return (
                  <>
                    {useCustomModel ? (
                      <input
                        type="text"
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        placeholder={modelsToShow[0]?.id || 'claude-sonnet-4-5-20250929'}
                        className="w-full px-4 py-2 bg-input rounded-lg border border-border focus:border-primary focus:outline-none transition-colors"
                      />
                    ) : (
                      <select
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        className="w-full px-4 py-2 bg-input rounded-lg border border-border focus:border-primary focus:outline-none transition-colors"
                      >
                        {modelsToShow.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <div className="mt-1 flex items-center justify-between gap-4">
                      <span className="text-xs text-muted-foreground">
                        {useCustomModel
                          ? t('Enter official model name')
                          : (modelsToShow.find((m) => m.id === model)?.description || '')}
                      </span>
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground/70 cursor-pointer hover:text-muted-foreground transition-colors whitespace-nowrap shrink-0">
                        <input
                          type="checkbox"
                          checked={useCustomModel}
                          onChange={(e) => {
                            setUseCustomModel(e.target.checked)
                            if (!e.target.checked && !modelsToShow.some(m => m.id === model)) {
                              setModel(modelsToShow[0]?.id || DEFAULT_MODEL)
                            }
                          }}
                          className="w-3 h-3 rounded border-border"
                        />
                        {t('Custom')}
                      </label>
                    </div>
                  </>
                )
              }

              // Providers with built-in models (non-Anthropic)
              if (hasBuiltinModels) {
                const modelsToShow = currentProviderConfig!.models
                return (
                  <>
                    {useCustomModel ? (
                      <input
                        type="text"
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        placeholder={modelsToShow[0]?.id}
                        className="w-full px-4 py-2 bg-input rounded-lg border border-border focus:border-primary focus:outline-none transition-colors"
                      />
                    ) : (
                      <select
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        className="w-full px-4 py-2 bg-input rounded-lg border border-border focus:border-primary focus:outline-none transition-colors"
                      >
                        {modelsToShow.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <div className="mt-1 flex items-center justify-between gap-4">
                      <span className="text-xs text-muted-foreground"></span>
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground/70 cursor-pointer hover:text-muted-foreground transition-colors whitespace-nowrap shrink-0">
                        <input
                          type="checkbox"
                          checked={useCustomModel}
                          onChange={(e) => {
                            setUseCustomModel(e.target.checked)
                            if (!e.target.checked && !modelsToShow.some(m => m.id === model)) {
                              setModel(modelsToShow[0]?.id)
                            }
                          }}
                          className="w-3 h-3 rounded border-border"
                        />
                        {t('Custom')}
                      </label>
                    </div>
                  </>
                )
              }

              // OpenAI compatible or providers without built-in models: text input + fetch
              return (
                <>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      {fetchedModels.length > 0 ? (
                        <select
                          value={model}
                          onChange={(e) => setModel(e.target.value)}
                          className="w-full px-4 py-2 bg-input rounded-lg border border-border focus:border-primary focus:outline-none transition-colors appearance-none"
                        >
                          {!fetchedModels.includes(model) && model && (
                            <option value={model}>{model}</option>
                          )}
                          {fetchedModels.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={model}
                          onChange={(e) => setModel(e.target.value)}
                          placeholder="gpt-4o-mini / deepseek-v4-flash"
                          className="w-full px-4 py-2 bg-input rounded-lg border border-border focus:border-primary focus:outline-none transition-colors"
                        />
                      )}
                      {fetchedModels.length > 0 && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground">
                          <ChevronDown className="w-4 h-4" />
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={fetchModels}
                      disabled={isFetchingModels || !apiKey || !apiUrl}
                      className="px-3 py-2 bg-secondary hover:bg-secondary/80 text-foreground rounded-lg border border-border transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title={t('Fetch available models')}
                    >
                      <RefreshCw className={`w-4 h-4 ${isFetchingModels ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('Enter model name or fetch available models from API')}
                  </p>
                </>
              )
            })()}
          </div>
        </div>

        {/* Help link */}
        <p className="text-center mt-4 text-sm text-muted-foreground">
          <a
            href="https://console.anthropic.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary cursor-pointer hover:underline inline-flex items-center gap-1"
          >
            <Lightbulb className="w-4 h-4 text-yellow-500" />
            {t("Don't know how to get it? View tutorial")}
          </a>
        </p>

        {/* Error message */}
        {error && (
          <p className="text-center mt-4 text-sm text-red-500">{error}</p>
        )}

        {/* Validation result */}
        {validationResult && (
          <div className={`mt-4 p-3 rounded-lg ${validationResult.valid ? 'bg-green-500/10 border border-green-500/30' : 'bg-red-500/10 border border-red-500/30'}`}>
            <p className={`text-sm flex items-center gap-2 ${validationResult.valid ? 'text-green-500' : 'text-red-500'}`}>
              {validationResult.valid ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
              <span>{validationResult.message}</span>
            </p>
          </div>
        )}

        {/* Buttons */}
        <div className="mt-6 flex gap-3">
          <button
            onClick={handleTestConnection}
            disabled={isValidating}
            className="px-4 py-3 bg-secondary text-foreground rounded-lg border border-border hover:bg-secondary/80 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 whitespace-nowrap"
          >
            {isValidating && <Loader2 className="w-4 h-4 animate-spin" />}
            {isValidating ? t('Testing...') : t('Test connection')}
          </button>
          <button
            onClick={handleSaveAndEnter}
            disabled={isValidating}
            className="flex-1 px-8 py-3 bg-primary text-primary-foreground rounded-lg btn-primary disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {t('Save and enter')}
          </button>
        </div>
      </div>
    </div>
  )
}
