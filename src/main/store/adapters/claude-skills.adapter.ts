/**
 * Claude Skills Registry Adapter
 *
 * Fetches from https://majiayu000.github.io/claude-skill-registry-core
 * API: GET /featured.json  (100 curated skills)
 *
 * Data model:
 *   - `install` = "owner/repo/path/to/skill-folder/SKILL.md"
 *   - `path`    = path within repo (e.g. ".claude/skills/fix/SKILL.md")
 *   - `repo`    = "owner/repo"
 *   - `branch`  = hint only; we use GitHub Contents API to avoid stale branch names
 *
 * fetchSpec recursively lists the skill folder via GitHub Contents API and
 * downloads all files, preserving the relative directory structure in
 * skill_files: Record<relativePath, content>.
 */

import { fetchWithTimeout } from './halo.adapter'
import { sanitizeSlug } from './mcp-registry.adapter'
import type { AppSpec, SkillSpec } from '../../apps/spec/schema'
import type { RegistrySource, RegistryIndex, RegistryEntry } from '../../../shared/store/store-types'
import type { RegistryAdapter } from './types'

// ── External API types ─────────────────────────────────────────────────────

interface FeaturedSkillRecord {
  name: string
  description?: string
  repo: string        // "owner/repo"
  path: string        // path within repo, e.g. ".claude/skills/fix/SKILL.md"
  branch?: string
  category?: string
  tags?: string[]
  stars?: number
  install: string     // "owner/repo/path/to/SKILL.md"
  source?: string
}

interface FeaturedIndex {
  updated_at?: string
  count?: number
  skills: FeaturedSkillRecord[]
}

interface GitHubFileEntry {
  name: string
  path: string
  type: 'file' | 'dir' | 'symlink' | 'submodule'
  download_url: string | null
}

// ── Helpers ────────────────────────────────────────────────────────────────

const GITHUB_HEADERS = {
  'User-Agent': 'Halo-Store/1.0',
  'Accept': 'application/vnd.github.v3+json',
}

/**
 * Recursively collect all files under a GitHub repo directory.
 * Returns a flat map of { relativePath: fileContent }.
 *
 * @param owner       GitHub repo owner
 * @param repo        GitHub repo name
 * @param dirPath     Path within the repo to start from (root of the skill folder)
 * @param prefix      Relative path prefix accumulated during recursion (empty string at root)
 * @param skillSlug   Used only for log/warning messages
 */
async function collectSkillFiles(
  owner: string,
  repo: string,
  dirPath: string,
  prefix: string,
  skillSlug: string,
): Promise<Record<string, string>> {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${dirPath}`
  const response = await fetchWithTimeout(apiUrl, { headers: GITHUB_HEADERS })

  if (!response.ok) {
    if (response.status === 403 || response.status === 429) {
      throw new Error(`GitHub API rate limit exceeded. Try again later. (${apiUrl})`)
    }
    throw new Error(`GitHub API ${response.status} for "${skillSlug}": ${apiUrl}`)
  }

  const listing = await response.json() as unknown
  if (!Array.isArray(listing)) {
    throw new Error(`GitHub API returned non-array listing for "${skillSlug}": ${apiUrl}`)
  }

  const entries = listing as GitHubFileEntry[]
  const result: Record<string, string> = {}

  // Process files and subdirectories concurrently
  await Promise.all(entries.map(async (entry) => {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name

    if (entry.type === 'file') {
      if (!entry.download_url) {
        console.warn(`[ClaudeSkillsAdapter] No download_url for "${relativePath}" in "${skillSlug}", skipping`)
        return
      }
      const res = await fetchWithTimeout(entry.download_url, { headers: { 'User-Agent': 'Halo-Store/1.0' } })
      if (!res.ok) {
        console.warn(`[ClaudeSkillsAdapter] Failed to download "${relativePath}" for "${skillSlug}": HTTP ${res.status}`)
        return
      }
      result[relativePath] = await res.text()

    } else if (entry.type === 'dir') {
      // Recurse into subdirectory
      const subFiles = await collectSkillFiles(owner, repo, entry.path, relativePath, skillSlug)
      Object.assign(result, subFiles)
    }
    // Skip symlinks and submodules
  }))

  return result
}

// ── Adapter ────────────────────────────────────────────────────────────────

export class ClaudeSkillsAdapter implements RegistryAdapter {
  readonly strategy = 'mirror' as const

  async fetchIndex(source: RegistrySource): Promise<RegistryIndex> {
    const baseUrl = source.url.replace(/\/+$/, '')
    const url = `${baseUrl}/featured.json`
    const t0 = performance.now()

    const response = await fetchWithTimeout(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Halo-Store/1.0' },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const data = await response.json() as unknown

    if (!data || typeof data !== 'object' || !('skills' in data) || !Array.isArray((data as FeaturedIndex).skills)) {
      throw new Error('Claude Skills Registry: unexpected featured.json format')
    }

    const skills = (data as FeaturedIndex).skills
    const apps: RegistryEntry[] = []
    const seenSlugs = new Set<string>()

    for (const skill of skills) {
      if (!skill.name || !skill.install) continue

      const slug = sanitizeSlug(skill.name)
      if (!slug || seenSlugs.has(slug)) continue
      seenSlugs.add(slug)

      apps.push({
        slug,
        name: skill.name,
        version: '1.0',
        author: skill.repo ?? 'community',
        description: skill.description ?? skill.name,
        type: 'skill',
        format: 'bundle',
        // Full install path: "owner/repo/path/to/SKILL.md"
        path: skill.install,
        category: skill.category ?? 'other',
        tags: Array.isArray(skill.tags) ? skill.tags : [],
        meta: {
          rank: typeof skill.stars === 'number' ? skill.stars : undefined,
          branch: skill.branch || 'main',
          repo: skill.repo,
        },
      })
    }

    const dt = performance.now() - t0
    console.log(`[ClaudeSkillsAdapter] Loaded ${apps.length} featured skills (${dt.toFixed(0)}ms)`)

    return {
      version: 1,
      generated_at: new Date().toISOString(),
      source: source.url,
      apps,
    }
  }

  async fetchSpec(source: RegistrySource, entry: RegistryEntry): Promise<AppSpec> {
    // entry.path = "owner/repo/path/to/skill-folder/SKILL.md"
    const installPath = entry.path
    if (!installPath) {
      throw new Error(`No install path for skill "${entry.slug}"`)
    }

    // Parse "owner/repo/rest-of-path"
    const parts = installPath.match(/^([^/]+)\/([^/]+)\/(.+)$/)
    if (!parts) {
      throw new Error(`Cannot parse install path for skill "${entry.slug}": "${installPath}"`)
    }
    const [, owner, repo, pathInRepo] = parts

    // If path ends with a file (has extension), strip it to get the directory.
    // e.g. ".claude/skills/fix/SKILL.md" → ".claude/skills/fix"
    // e.g. "skills/scientific/clinical-decision-support" → unchanged
    const dirPath = /\/SKILL\.md$/i.test(pathInRepo)
      ? pathInRepo.replace(/\/SKILL\.md$/i, '')
      : pathInRepo

    // Recursively collect all files, preserving relative paths
    const skill_files = await collectSkillFiles(owner, repo, dirPath, '', entry.slug)

    if (Object.keys(skill_files).length === 0) {
      throw new Error(`No files found (or all downloads failed) for skill "${entry.slug}": ${dirPath}`)
    }

    console.log(
      `[ClaudeSkillsAdapter] Collected ${Object.keys(skill_files).length} files for "${entry.slug}": ` +
      Object.keys(skill_files).join(', ')
    )

    const spec: SkillSpec = {
      spec_version: '1',
      name: entry.name,
      type: 'skill',
      version: entry.version,
      description: entry.description,
      author: entry.author,
      skill_files,
      store: {
        slug: entry.slug,
        registry_id: source.id,
      },
    }
    return spec
  }
}
