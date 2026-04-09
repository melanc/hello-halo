/**
 * SkillInstallDialog
 *
 * Modal dialog for creating / installing a Skill.
 * Three modes:
 *   - Visual (default): simple form — name, description, body content
 *   - MD: full CodeMirror editor with pre-filled SKILL.md frontmatter template;
 *         two-way sync with Visual mode
 *   - Import: drag-and-drop / browse supporting:
 *       • Single .md file  → single-file skill (auto-wrapped as SKILL.md)
 *       • Folder (via webkitdirectory or drag)  → multi-file skill; must contain SKILL.md
 *       • .zip file  → extracted; must contain SKILL.md at root or in a single top folder
 *     Clear error feedback for any unsupported / malformed input.
 */

import {
  useState,
  useMemo,
  useCallback,
  useRef,
  lazy,
  Suspense,
} from 'react'
import { X, Loader2, Upload, FolderOpen, FileText, Archive, AlertCircle } from 'lucide-react'
import { useAppsStore } from '../../stores/apps.store'
import { useSpaceStore } from '../../stores/space.store'
import { useTranslation } from '../../i18n'
import type { SkillSpec } from '../../../shared/apps/spec-types'

// Lazy-load CodeMirrorEditor to keep initial bundle small
const CodeMirrorEditor = lazy(() =>
  import('../canvas/viewers/CodeMirrorEditor').then(m => ({ default: m.CodeMirrorEditor }))
)

// ============================================
// Types
// ============================================

type SkillMode = 'visual' | 'md' | 'import'

interface VisualForm {
  name: string
  description: string
  /** Markdown content body — everything after the frontmatter */
  bodyContent: string
}

const INITIAL_FORM: VisualForm = {
  name: '',
  description: '',
  bodyContent: '',
}

/** A successfully parsed / assembled skill ready to install */
interface ParsedSkill {
  /** Slug-friendly name derived from frontmatter or file/folder name */
  name: string
  /** Description from frontmatter */
  description: string
  /** All files keyed by relative path.  Single-file skills have only 'SKILL.md'. */
  skillFiles: Record<string, string>
}

// ============================================
// Frontmatter helpers
// ============================================

/**
 * Derive a slug-friendly name from an arbitrary string.
 * "My Cool Skill" → "my-cool-skill"
 */
function toSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Build a SKILL.md string from the Visual form.
 */
function buildMdFromForm(form: VisualForm): string {
  const slug = toSlug(form.name) || 'my-skill'
  const desc = form.description.trim() || 'My skill description'
  const headline = form.name.trim() || 'My Skill'
  const body = form.bodyContent.trim()
    || `# ${headline}\n\nWrite your skill instructions here...`

  return `---\nname: ${slug}\ndescription: ${desc}\n---\n\n${body}`
}

/**
 * Parse a SKILL.md string into its frontmatter fields and body.
 * Returns empty strings if frontmatter is absent.
 */
function parseMd(content: string): { name: string; description: string; bodyContent: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { name: '', description: '', bodyContent: content.trim() }
  const fm = match[1]
  const body = match[2].trim()
  const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '') ?? ''
  const description = fm.match(/^description:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '') ?? ''
  return { name, description, bodyContent: body }
}

// ============================================
// File-reading utilities
// ============================================

function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => resolve(e.target!.result as string)
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`))
    reader.readAsText(file)
  })
}

/** Read all entries from a FileSystemDirectoryReader, handling the 100-entry limit. */
async function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const all: FileSystemEntry[] = []
  while (true) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject)
    )
    if (batch.length === 0) break
    all.push(...batch)
  }
  return all
}

/**
 * Recursively walk a FileSystemDirectoryEntry and return all file contents
 * keyed by their paths relative to the entry itself.
 */
async function readDirectoryEntry(
  entry: FileSystemDirectoryEntry,
  prefix = ''
): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  const entries = await readAllEntries(entry.createReader())

  for (const child of entries) {
    if (child.isFile) {
      const fileEntry = child as FileSystemFileEntry
      const file = await new Promise<File>((resolve, reject) =>
        fileEntry.file(resolve, reject)
      )
      const content = await readFileText(file)
      result[prefix + child.name] = content
    } else if (child.isDirectory) {
      const subDir = child as FileSystemDirectoryEntry
      const sub = await readDirectoryEntry(subDir, prefix + child.name + '/')
      Object.assign(result, sub)
    }
  }
  return result
}

/**
 * Build a ParsedSkill from a single .md file.
 * The file is always stored as 'SKILL.md' regardless of its original name.
 */
async function processMdFile(file: File): Promise<ParsedSkill> {
  const content = await readFileText(file)
  const { name, description } = parseMd(content)
  return {
    name: name || toSlug(file.name.replace(/\.md$/i, '')),
    description: description || '',
    skillFiles: { 'SKILL.md': content },
  }
}

/**
 * Build a ParsedSkill from a FileSystemDirectoryEntry (drag-drop folder).
 * The entry is the folder itself; we strip its name from all paths.
 */
async function processDirectoryEntry(entry: FileSystemDirectoryEntry): Promise<ParsedSkill> {
  const files = await readDirectoryEntry(entry)

  if (!files['SKILL.md']) {
    throw new Error('SKILL.md not found. A skill folder must contain SKILL.md at its root.')
  }

  const { name, description } = parseMd(files['SKILL.md'])
  return {
    name: name || toSlug(entry.name),
    description: description || '',
    skillFiles: files,
  }
}

/**
 * Build a ParsedSkill from a FileList produced by <input webkitdirectory>.
 * Each file's webkitRelativePath is "folderName/path/to/file".
 */
async function processFileListAsFolder(fileList: FileList): Promise<ParsedSkill> {
  const skillFiles: Record<string, string> = {}
  let folderName = ''

  for (const file of Array.from(fileList)) {
    const relPath = file.webkitRelativePath // e.g. "devx-dev/SKILL.md"
    const parts = relPath.split('/')
    if (parts.length < 2) continue
    if (!folderName) folderName = parts[0]
    const filePath = parts.slice(1).join('/') // strip top-level folder segment
    if (!filePath) continue
    skillFiles[filePath] = await readFileText(file)
  }

  if (!skillFiles['SKILL.md']) {
    throw new Error('SKILL.md not found. A skill folder must contain SKILL.md at its root.')
  }

  const { name, description } = parseMd(skillFiles['SKILL.md'])
  return {
    name: name || toSlug(folderName),
    description: description || '',
    skillFiles,
  }
}

/**
 * Build a ParsedSkill from a .zip file.
 * Uses fflate (pure-JS, no Node.js required).
 * Supports both flat ZIPs (SKILL.md at root) and wrapped ZIPs
 * (all files inside a single top-level folder).
 * macOS metadata injected by Finder (__MACOSX/, ._*, .DS_Store) is ignored.
 */
async function processZipFile(file: File): Promise<ParsedSkill> {
  const { unzipSync } = await import('fflate')
  const buffer = await file.arrayBuffer()
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(new Uint8Array(buffer))
  } catch {
    throw new Error('Could not extract ZIP. Make sure the file is a valid ZIP archive.')
  }

  // Build a raw map (skip directory-only entries and macOS metadata)
  const rawFiles: Record<string, string> = {}
  for (const [path, bytes] of Object.entries(entries)) {
    if (path.endsWith('/')) continue // directory entry
    // Skip macOS-injected metadata (Finder adds these automatically when compressing)
    if (path.startsWith('__MACOSX/')) continue
    if (path.split('/').some(seg => seg === '.DS_Store' || seg.startsWith('._'))) continue
    rawFiles[path] = new TextDecoder('utf-8').decode(bytes)
  }

  if (Object.keys(rawFiles).length === 0) {
    throw new Error('ZIP archive is empty.')
  }

  // Detect a single common top-level folder (e.g. "devx-dev/")
  const topDirs = new Set(
    Object.keys(rawFiles)
      .map(p => p.split('/')[0])
      .filter(Boolean)
  )

  // If every file lives inside the same top-level folder AND that folder
  // is not a file itself, treat it as a wrapper and strip it.
  let skillFiles: Record<string, string> = {}
  if (topDirs.size === 1) {
    const prefix = [...topDirs][0] + '/'
    const allInPrefix = Object.keys(rawFiles).every(p => p.startsWith(prefix))
    if (allInPrefix) {
      for (const [path, content] of Object.entries(rawFiles)) {
        const stripped = path.slice(prefix.length)
        if (stripped) skillFiles[stripped] = content
      }
    } else {
      skillFiles = rawFiles
    }
  } else {
    skillFiles = rawFiles
  }

  if (!skillFiles['SKILL.md']) {
    throw new Error(
      'SKILL.md not found in ZIP. The archive must contain SKILL.md at the root level, ' +
      'or inside a single top-level folder.'
    )
  }

  const { name, description } = parseMd(skillFiles['SKILL.md'])
  const folderName = file.name.replace(/\.zip$/i, '')
  return {
    name: name || toSlug(folderName),
    description: description || '',
    skillFiles,
  }
}

// ============================================
// ImportDropZone sub-component
// ============================================

/** Describes what the user has loaded, before they confirm install */
interface ImportedSkill {
  parsed: ParsedSkill
  /** Display label for the loaded source (filename / folder name) */
  label: string
  /** Icon type for display */
  sourceType: 'md' | 'folder' | 'zip'
}

interface ImportDropZoneProps {
  imported: ImportedSkill | null
  onImported: (skill: ImportedSkill) => void
  onClear: () => void
  onError: (msg: string) => void
}

function ImportDropZone({ imported, onImported, onClear, onError }: ImportDropZoneProps) {
  const { t } = useTranslation()
  const [isDragOver, setIsDragOver] = useState(false)
  const [processing, setProcessing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  const handleProcess = useCallback(async (task: () => Promise<ImportedSkill>) => {
    setProcessing(true)
    try {
      const result = await task()
      onImported(result)
    } catch (err) {
      onError(err instanceof Error ? err.message : t('Failed to read file'))
    } finally {
      setProcessing(false)
    }
  }, [onImported, onError, t])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    onError('') // clear previous error

    // Prefer the FileSystem Entry API for correct folder support
    const items = e.dataTransfer.items
    if (items && items.length > 0) {
      const item = items[0]
      const entry = item.webkitGetAsEntry?.()

      if (entry?.isDirectory) {
        const dirEntry = entry as FileSystemDirectoryEntry
        await handleProcess(async () => ({
          parsed: await processDirectoryEntry(dirEntry),
          label: dirEntry.name,
          sourceType: 'folder' as const,
        }))
        return
      }

      if (entry?.isFile) {
        const fileEntry = entry as FileSystemFileEntry
        const file = await new Promise<File>((resolve, reject) =>
          fileEntry.file(resolve, reject)
        )
        await handleDroppedFile(file)
        return
      }
    }

    // Fallback: plain File
    const file = e.dataTransfer.files[0]
    if (file) await handleDroppedFile(file)
  }, [handleProcess]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleDroppedFile(file: File) {
    const name = file.name.toLowerCase()
    if (name.endsWith('.md')) {
      await handleProcess(async () => ({
        parsed: await processMdFile(file),
        label: file.name,
        sourceType: 'md' as const,
      }))
    } else if (name.endsWith('.zip')) {
      await handleProcess(async () => ({
        parsed: await processZipFile(file),
        label: file.name,
        sourceType: 'zip' as const,
      }))
    } else {
      onError(t('Unsupported file type. Drop a .md file, a .zip archive, or a skill folder.'))
    }
  }

  const handleFileInput = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = '' // allow re-selecting same file
    await handleDroppedFile(file)
  }, [handleProcess]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleFolderInput = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    e.target.value = ''
    await handleProcess(async () => ({
      parsed: await processFileListAsFolder(files),
      label: files[0].webkitRelativePath.split('/')[0] || t('Folder'),
      sourceType: 'folder' as const,
    }))
  }, [handleProcess, t])

  if (imported) {
    const Icon = imported.sourceType === 'folder' ? FolderOpen
      : imported.sourceType === 'zip' ? Archive
      : FileText
    const fileCount = Object.keys(imported.parsed.skillFiles).length

    return (
      <div className="space-y-3">
        {/* Loaded file summary */}
        <div className="flex items-center justify-between p-3 bg-secondary rounded-lg border border-border">
          <div className="flex items-center gap-2.5 min-w-0">
            <Icon className="w-4 h-4 text-primary flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{imported.label}</p>
              <p className="text-xs text-muted-foreground">
                {fileCount === 1
                  ? t('1 file')
                  : t('{{count}} files', { count: fileCount })}
                {imported.parsed.name && (
                  <> · <span className="font-mono">/{imported.parsed.name}</span></>
                )}
              </p>
            </div>
          </div>
          <button
            onClick={onClear}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 ml-2"
          >
            {t('Clear')}
          </button>
        </div>

        {/* SKILL.md preview */}
        <Suspense fallback={
          <div className="h-56 flex items-center justify-center bg-secondary rounded-lg border border-border">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        }>
          <div className="h-56 border border-border rounded-lg overflow-hidden">
            <CodeMirrorEditor
              content={imported.parsed.skillFiles['SKILL.md'] ?? ''}
              language="markdown"
              readOnly={true}
            />
          </div>
        </Suspense>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setIsDragOver(true) }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`flex flex-col items-center justify-center gap-3 h-48 border-2 border-dashed rounded-lg cursor-pointer select-none transition-colors ${
          isDragOver
            ? 'border-primary bg-primary/5'
            : 'border-border hover:border-muted-foreground/50'
        }`}
      >
        {processing
          ? <Loader2 className="w-7 h-7 text-muted-foreground animate-spin" />
          : <Upload className={`w-7 h-7 ${isDragOver ? 'text-primary' : 'text-muted-foreground'}`} />
        }
        <div className="text-center px-4">
          <p className="text-sm text-foreground">
            {t('Drop a skill file or folder here')}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {t('.md file · skill folder · .zip archive')}
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.zip"
          onChange={handleFileInput}
          className="hidden"
        />
      </div>

      {/* Browse folder button */}
      <button
        type="button"
        onClick={() => folderInputRef.current?.click()}
        className="flex items-center gap-2 w-full px-3 py-2 text-sm text-muted-foreground hover:text-foreground border border-border hover:border-muted-foreground/50 rounded-lg transition-colors"
      >
        <FolderOpen className="w-4 h-4" />
        {t('Browse skill folder...')}
        <input
          ref={folderInputRef}
          type="file"
          // @ts-expect-error -- non-standard but supported in Electron/Chrome
          webkitdirectory=""
          onChange={handleFolderInput}
          className="hidden"
        />
      </button>

      {/* Format hints */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {t('Supported formats')}
        </p>
        <div className="space-y-1">
          {[
            { Icon: FileText, label: t('Single .md file'), sub: t('Treated as a one-file skill; auto-named SKILL.md') },
            { Icon: FolderOpen, label: t('Skill folder'), sub: t('Must contain SKILL.md at the root level') },
            { Icon: Archive, label: t('.zip archive'), sub: t('May contain files at root or inside a single folder') },
          ].map(({ Icon, label, sub }) => (
            <div key={label} className="flex items-start gap-2 px-2 py-1.5">
              <Icon className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
              <div>
                <span className="text-xs text-foreground">{label}</span>
                <span className="text-xs text-muted-foreground"> — {sub}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ============================================
// Main component
// ============================================

export interface SkillInstallDialogProps {
  onClose: () => void
}

export function SkillInstallDialog({ onClose }: SkillInstallDialogProps) {
  const { t } = useTranslation()
  const { installApp, loadApps } = useAppsStore()

  // Spaces
  const currentSpace = useSpaceStore(state => state.currentSpace)
  const devxSpace = useSpaceStore(state => state.devxSpace)
  const spaces = useSpaceStore(state => state.spaces)

  // All spaces, plus a sentinel '' = global
  const allSpaces = useMemo(() => {
    const result: Array<{ id: string; name: string }> = [
      { id: '', name: t('Global (all spaces)') },
    ]
    if (devxSpace) result.push({ id: devxSpace.id, name: devxSpace.name })
    result.push(...spaces.map(s => ({ id: s.id, name: s.name })))
    return result
  }, [devxSpace, spaces, t])

  // Default: current space if any, else global
  const [selectedSpaceId, setSelectedSpaceId] = useState(currentSpace?.id ?? '')

  // Mode
  const [mode, setMode] = useState<SkillMode>('visual')

  // Visual form state
  const [form, setForm] = useState<VisualForm>({ ...INITIAL_FORM })

  // MD editor state
  const [mdContent, setMdContent] = useState(buildMdFromForm(INITIAL_FORM))

  // Import state
  const [imported, setImported] = useState<ImportedSkill | null>(null)

  // UI state
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // ── Form field helper ──
  const updateField = useCallback(<K extends keyof VisualForm>(key: K, val: VisualForm[K]) => {
    setForm(prev => ({ ...prev, [key]: val }))
    setError(null)
  }, [])

  // ── Mode switching ──
  const handleSwitchToMd = useCallback(() => {
    setError(null)
    // Serialize current form into MD (only if the form has something)
    if (form.name || form.description || form.bodyContent) {
      setMdContent(buildMdFromForm(form))
    }
    setMode('md')
  }, [form])

  const handleSwitchToVisual = useCallback(() => {
    setError(null)
    // Try to parse MD back into form fields
    const { name, description, bodyContent } = parseMd(mdContent)
    setForm({
      name: name || form.name,
      description: description || form.description,
      bodyContent: bodyContent || form.bodyContent,
    })
    setMode('visual')
  }, [mdContent, form])

  // ── Build spec and install ──
  async function handleInstall() {
    setError(null)
    setLoading(true)

    try {
      let spec: Omit<SkillSpec, 'spec_version' | 'version' | 'author'>

      if (mode === 'import') {
        if (!imported) {
          setError(t('No skill loaded. Drop a file or folder first.'))
          setLoading(false)
          return
        }
        const { name, description, skillFiles } = imported.parsed
        if (!name) {
          setError(t('Could not determine skill name. Make sure SKILL.md has a name field in its frontmatter.'))
          setLoading(false)
          return
        }
        spec = {
          name,
          description: description || `Skill: ${name}`,
          type: 'skill',
          skill_files: skillFiles,
        }
      } else {
        // Visual or MD mode
        let name: string
        let description: string
        let skillContent: string

        if (mode === 'md') {
          const parsed = parseMd(mdContent)
          name = parsed.name
          description = parsed.description
          skillContent = mdContent
        } else {
          // Visual mode — build MD from form
          if (!form.name.trim()) {
            setError(t('Skill name is required'))
            setLoading(false)
            return
          }
          name = toSlug(form.name)
          description = form.description.trim() || `Skill: ${name}`
          skillContent = buildMdFromForm(form)
        }

        if (!name) {
          setError(t('Skill name is required. Add a "name:" field in the frontmatter.'))
          setLoading(false)
          return
        }

        spec = {
          name,
          description: description || `Skill: ${name}`,
          type: 'skill',
          skill_content: skillContent,
        }
      }

      const fullSpec: SkillSpec = {
        spec_version: '1.0',
        version: '1.0',
        ...spec,
      }

      const spaceId = selectedSpaceId || null
      const appId = await installApp(spaceId, fullSpec)
      if (appId) {
        await loadApps()
        onClose()
      } else {
        setError(t('Installation failed. Check the skill content and try again.'))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Installation failed'))
    } finally {
      setLoading(false)
    }
  }

  const canInstall =
    mode === 'import'
      ? imported !== null
      : mode === 'md'
        ? mdContent.trim().length > 0
        : form.name.trim().length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onMouseDown={onClose}>
      <div
        className="relative w-full max-w-2xl mx-4 bg-background border border-border rounded-xl shadow-xl flex flex-col max-h-[90vh]"
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold">{t('Add Skill')}</h2>

            {/* Mode toggle */}
            <div className="flex items-center gap-0.5 bg-secondary rounded-lg p-0.5">
              <button
                onClick={() => mode !== 'visual' && handleSwitchToVisual()}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                  mode === 'visual'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t('Visual')}
              </button>
              <button
                onClick={() => mode !== 'md' && handleSwitchToMd()}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                  mode === 'md'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                MD
              </button>
              <button
                onClick={() => { setError(null); setMode('import') }}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                  mode === 'import'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t('Import')}
              </button>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground rounded-md transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4 overflow-y-auto flex-1">
          {mode === 'visual' && (
            <>
              <p className="text-xs text-muted-foreground">
                {t('Create a skill using the form below, or switch to MD for full control.')}
              </p>

              {/* Name */}
              <div className="space-y-1.5">
                <label className="text-sm text-foreground">
                  {t('Skill Name')} <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => updateField('name', e.target.value)}
                  placeholder={t('e.g. code-review-guidelines')}
                  className="w-full px-3 py-2 text-sm bg-secondary border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground/50"
                  autoFocus
                />
                {form.name && (
                  <p className="text-xs text-muted-foreground font-mono">
                    /{toSlug(form.name)}
                  </p>
                )}
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <label className="text-sm text-foreground">
                  {t('Description')}
                </label>
                <input
                  type="text"
                  value={form.description}
                  onChange={e => updateField('description', e.target.value)}
                  placeholder={t('When should the AI use this skill?')}
                  className="w-full px-3 py-2 text-sm bg-secondary border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground/50"
                />
              </div>

              {/* Content */}
              <div className="space-y-1.5">
                <label className="text-sm text-foreground">
                  {t('Instructions')}
                  <span className="text-muted-foreground font-normal ml-1">(Markdown)</span>
                </label>
                <textarea
                  value={form.bodyContent}
                  onChange={e => updateField('bodyContent', e.target.value)}
                  rows={8}
                  placeholder={t('Write the skill instructions here in Markdown...')}
                  className="w-full px-3 py-2 text-sm bg-secondary border border-border rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground/50 font-mono"
                  spellCheck={false}
                />
              </div>
            </>
          )}

          {mode === 'md' && (
            <>
              <p className="text-xs text-muted-foreground">
                {t('Edit the full SKILL.md content directly. The frontmatter name and description fields are required.')}
              </p>
              <Suspense fallback={
                <div className="h-80 flex items-center justify-center bg-secondary rounded-lg border border-border">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              }>
                <div className="h-80 border border-border rounded-lg overflow-hidden">
                  <CodeMirrorEditor
                    content={mdContent}
                    language="markdown"
                    readOnly={false}
                    onChange={setMdContent}
                  />
                </div>
              </Suspense>
            </>
          )}

          {mode === 'import' && (
            <>
              <p className="text-xs text-muted-foreground">
                {t('Import a skill from a local file or folder.')}
              </p>
              <ImportDropZone
                imported={imported}
                onImported={skill => { setImported(skill); setError(null) }}
                onClear={() => { setImported(null); setError(null) }}
                onError={msg => { if (msg) setError(msg) }}
              />
            </>
          )}

          {/* Space selector */}
          <div className="space-y-1.5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('Install to')}
            </h3>
            {allSpaces.length <= 1 ? (
              <p className="text-sm text-foreground">
                {allSpaces[0]?.name ?? t('No spaces available')}
              </p>
            ) : (
              <select
                value={selectedSpaceId}
                onChange={e => setSelectedSpaceId(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-secondary border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
              >
                {allSpaces.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 px-3 py-2 bg-destructive/10 border border-destructive/20 rounded-lg">
              <AlertCircle className="w-3.5 h-3.5 text-destructive mt-0.5 flex-shrink-0" />
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border flex-shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {t('Cancel')}
          </button>
          <button
            onClick={handleInstall}
            disabled={loading || !canInstall}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {t('Install Skill')}
          </button>
        </div>
      </div>
    </div>
  )
}
