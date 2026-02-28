/**
 * apps/manager -- Skill Filesystem Sync
 *
 * Synchronizes Skill app records from the database to filesystem `.md` files
 * so that the Claude Code SDK auto-loads them.
 *
 * Paths:
 *   - Global skills:      $CLAUDE_CONFIG_DIR/skills/<specId>/SKILL.md
 *   - Space-scoped skills: <spacePath>/.claude/skills/<specId>/SKILL.md
 *
 * This module is called by the service layer on install/uninstall/reinstall/delete.
 */

import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join, resolve, dirname, normalize } from 'path'
import { app } from 'electron'
import type { InstalledApp } from './types'
import type { SkillSpec } from '../../apps/spec/schema'

/**
 * Get the global Claude config skills directory.
 * Creates it if it doesn't exist.
 */
function getGlobalSkillsDir(): string {
  const configDir = join(app.getPath('userData'), 'claude-config')
  const skillsDir = join(configDir, 'skills')
  if (!existsSync(skillsDir)) {
    mkdirSync(skillsDir, { recursive: true })
  }
  return skillsDir
}

/**
 * Get the space-scoped skills directory.
 * Creates it if it doesn't exist.
 */
function getSpaceSkillsDir(spacePath: string): string {
  const skillsDir = join(spacePath, '.claude', 'skills')
  if (!existsSync(skillsDir)) {
    mkdirSync(skillsDir, { recursive: true })
  }
  return skillsDir
}

/**
 * Sanitize specId into a safe filename.
 * Replaces non-alphanumeric chars (except dash/underscore) with underscores.
 */
function toSafeFilename(specId: string): string {
  return specId.replace(/[^a-zA-Z0-9_-]/g, '_')
}

/**
 * Resolve the on-disk directory for a skill app without performing any I/O.
 * Returns null if the space cannot be resolved.
 *
 * Used by IPC handlers that need to open the folder in the OS file manager.
 */
export function getSkillDir(
  appRecord: InstalledApp,
  getSpacePath: (spaceId: string) => string | null
): string | null {
  if (appRecord.spec.type !== 'skill') return null

  const dirName = toSafeFilename(appRecord.specId)

  if (appRecord.spaceId === null) {
    return join(getGlobalSkillsDir(), dirName)
  }

  const spacePath = getSpacePath(appRecord.spaceId)
  if (!spacePath) return null
  return join(getSpaceSkillsDir(spacePath), dirName)
}

/**
 * Write a skill's content to the appropriate filesystem location.
 * Called on install/reinstall of a skill app.
 */
export function syncSkillToFilesystem(
  appRecord: InstalledApp,
  getSpacePath: (spaceId: string) => string | null
): void {
  if (appRecord.spec.type !== 'skill') return

  const spec = appRecord.spec as SkillSpec

  // skill_files takes priority (registry installs); fall back to skill_content (manual add)
  const skillFiles: Record<string, string> = spec.skill_files
    ?? (spec.skill_content ? { 'SKILL.md': spec.skill_content } : {})

  if (Object.keys(skillFiles).length === 0) {
    console.warn(`[SkillSync] Skill '${appRecord.specId}' has no skill_files or skill_content, skipping filesystem sync`)
    return
  }

  const dirName = toSafeFilename(appRecord.specId)

  const skillDir = appRecord.spaceId === null
    ? join(getGlobalSkillsDir(), dirName)
    : (() => {
        const spacePath = getSpacePath(appRecord.spaceId)
        if (!spacePath) {
          console.warn(`[SkillSync] Space '${appRecord.spaceId}' not found, skipping filesystem sync`)
          return null
        }
        return join(getSpaceSkillsDir(spacePath), dirName)
      })()

  if (!skillDir) return

  mkdirSync(skillDir, { recursive: true })
  const resolvedSkillDir = resolve(skillDir)

  for (const [filename, content] of Object.entries(skillFiles)) {
    // normalize() collapses ".." segments; the startsWith guard below
    // rejects any path that still escapes the skill directory.
    const target = resolve(skillDir, normalize(filename))
    if (!target.startsWith(resolvedSkillDir + '/') && target !== resolvedSkillDir) {
      console.warn(`[SkillSync] Skipping unsafe path "${filename}" for skill '${appRecord.specId}'`)
      continue
    }
    // Create intermediate subdirectories (e.g. "references/INDEX.md" → mkdir references/)
    const targetDir = dirname(target)
    if (targetDir !== resolvedSkillDir) {
      mkdirSync(targetDir, { recursive: true })
    }
    writeFileSync(target, content, 'utf-8')
  }

  const scope = appRecord.spaceId === null ? 'global' : 'space'
  console.log(`[SkillSync] Written ${scope} skill: ${skillDir}/ (${Object.keys(skillFiles).length} files)`)
}

/**
 * Remove a skill's file from the filesystem.
 * Called on uninstall/delete of a skill app.
 */
export function removeSkillFromFilesystem(
  appRecord: InstalledApp,
  getSpacePath: (spaceId: string) => string | null
): void {
  if (appRecord.spec.type !== 'skill') return

  const dirName = toSafeFilename(appRecord.specId)

  if (appRecord.spaceId === null) {
    // Global skill
    const skillDir = join(getGlobalSkillsDir(), dirName)
    if (existsSync(skillDir)) {
      rmSync(skillDir, { recursive: true, force: true })
      console.log(`[SkillSync] Removed global skill: ${skillDir}`)
    }
  } else {
    // Space-scoped skill
    const spacePath = getSpacePath(appRecord.spaceId)
    if (!spacePath) return
    const skillDir = join(getSpaceSkillsDir(spacePath), dirName)
    if (existsSync(skillDir)) {
      rmSync(skillDir, { recursive: true, force: true })
      console.log(`[SkillSync] Removed space skill: ${skillDir}`)
    }
  }
}
