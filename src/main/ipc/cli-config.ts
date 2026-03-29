/**
 * CLI Config IPC Handlers
 *
 * Handles Claude CLI config directory management and migration:
 * - Get current path configuration
 * - Scan and migrate Skills from ~/.claude/skills/ to Halo
 * - Scan and migrate MCP servers from ~/.claude.json to Halo
 * - Update CLAUDE_CONFIG_DIR mode (halo default / cc default / custom)
 */

import { ipcMain } from 'electron'
import { join, resolve } from 'path'
import { homedir } from 'os'
import { stat, readdir, mkdir, cp, readFile, access } from 'fs/promises'
import { getConfig, saveConfig, resolveClaudeConfigDir } from '../services/config.service'
import type { McpServerConfig } from '../services/config.service'

// ============================================
// Path helpers
// ============================================

function getCCDefaultDir(): string {
  return join(homedir(), '.claude')
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

// ============================================
// Register handlers
// ============================================

export function registerCliConfigHandlers(): void {

  // ── Get current path info ────────────────────────────────────────────────
  ipcMain.handle('cli-config:get-paths', async () => {
    console.log('[CliConfig] cli-config:get-paths')
    try {
      const config = getConfig()
      const mode = config.agent?.configDirMode ?? 'halo'
      return {
        success: true,
        data: {
          haloDefault: resolveClaudeConfigDir('halo'),
          ccDefault: getCCDefaultDir(),
          current: resolveClaudeConfigDir(mode, config.agent?.customConfigDir),
          configDirMode: mode,
          customConfigDir: config.agent?.customConfigDir,
        }
      }
    } catch (error: unknown) {
      const err = error as Error
      console.error('[CliConfig] cli-config:get-paths failed:', err.message)
      return { success: false, error: err.message }
    }
  })

  // ── Scan skills for conflicts ────────────────────────────────────────────
  ipcMain.handle('cli-config:scan-skills', async () => {
    console.log('[CliConfig] cli-config:scan-skills')
    try {
      const ccSkillsDir = join(getCCDefaultDir(), 'skills')
      const haloSkillsDir = join(resolveClaudeConfigDir('halo'), 'skills')

      if (!(await pathExists(ccSkillsDir))) {
        return { success: true, data: { skills: [], ccSkillsDir, haloSkillsDir } }
      }

      const entries = await readdir(ccSkillsDir)
      const skills: Array<{ name: string; ccPath: string; haloPath: string; exists: boolean }> = []

      for (const name of entries) {
        const entryPath = join(ccSkillsDir, name)
        const entryStat = await stat(entryPath)
        if (entryStat.isDirectory()) {
          skills.push({
            name,
            ccPath: entryPath,
            haloPath: join(haloSkillsDir, name),
            exists: await pathExists(join(haloSkillsDir, name)),
          })
        }
      }

      console.log(`[CliConfig] scan-skills: found ${skills.length} CC skills`)
      return { success: true, data: { skills, ccSkillsDir, haloSkillsDir } }
    } catch (error: unknown) {
      const err = error as Error
      console.error('[CliConfig] scan-skills failed:', err.message)
      return { success: false, error: err.message }
    }
  })

  // ── Migrate skills ───────────────────────────────────────────────────────
  ipcMain.handle(
    'cli-config:migrate-skills',
    async (
      _event,
      actions: Array<{ name: string; action: 'skip' | 'overwrite' | 'rename' }>
    ) => {
      console.log('[CliConfig] cli-config:migrate-skills, items:', actions.length)
      try {
        const ccSkillsDir = join(getCCDefaultDir(), 'skills')
        const haloSkillsDir = join(resolveClaudeConfigDir('halo'), 'skills')

        await mkdir(haloSkillsDir, { recursive: true })

        const results: Array<{ name: string; status: 'migrated' | 'skipped' | 'renamed' | 'error'; dest?: string; error?: string }> = []

        for (const { name, action } of actions) {
          const srcDir = join(ccSkillsDir, name)
          if (!(await pathExists(srcDir))) {
            results.push({ name, status: 'skipped' })
            continue
          }

          try {
            if (action === 'skip') {
              results.push({ name, status: 'skipped' })
              continue
            }

            let destName = name
            if (action === 'rename') {
              let suffix = 1
              while (await pathExists(join(haloSkillsDir, `${name}-cc${suffix > 1 ? String(suffix) : ''}`))) {
                suffix++
              }
              destName = `${name}-cc${suffix > 1 ? String(suffix) : ''}`
            }

            const destDir = join(haloSkillsDir, destName)
            await cp(srcDir, destDir, { recursive: true, force: true })
            console.log(`[CliConfig] Migrated skill: ${name} -> ${destName}`)
            results.push({ name, status: action === 'rename' ? 'renamed' : 'migrated', dest: destName })
          } catch (err: unknown) {
            const e = err as Error
            console.error(`[CliConfig] Failed to migrate skill '${name}':`, e.message)
            results.push({ name, status: 'error', error: e.message })
          }
        }

        const migratedCount = results.filter(r => r.status === 'migrated' || r.status === 'renamed').length
        console.log(`[CliConfig] Skills migration complete: ${migratedCount}/${actions.length} migrated`)
        return { success: true, data: { results } }
      } catch (error: unknown) {
        const err = error as Error
        console.error('[CliConfig] migrate-skills failed:', err.message)
        return { success: false, error: err.message }
      }
    }
  )

  // ── Scan MCP servers for conflicts ──────────────────────────────────────
  ipcMain.handle('cli-config:scan-mcp', async () => {
    console.log('[CliConfig] cli-config:scan-mcp')
    try {
      const ccJsonPath = join(homedir(), '.claude.json')
      const haloConfig = getConfig()
      const haloMcpServers: Record<string, unknown> = haloConfig.mcpServers ?? {}

      if (!(await pathExists(ccJsonPath))) {
        return { success: true, data: { servers: [], ccJsonPath } }
      }

      let ccData: Record<string, unknown>
      try {
        ccData = JSON.parse(await readFile(ccJsonPath, 'utf-8'))
      } catch {
        return { success: false, error: 'Failed to parse ~/.claude.json' }
      }

      const ccServers = (ccData.mcpServers ?? {}) as Record<string, unknown>
      const servers = Object.entries(ccServers).map(([name, ccConfig]) => ({
        name,
        ccConfig,
        haloConfig: haloMcpServers[name],
        exists: name in haloMcpServers,
      }))

      console.log(`[CliConfig] scan-mcp: found ${servers.length} CC MCP servers`)
      return { success: true, data: { servers, ccJsonPath } }
    } catch (error: unknown) {
      const err = error as Error
      console.error('[CliConfig] scan-mcp failed:', err.message)
      return { success: false, error: err.message }
    }
  })

  // ── Migrate MCP servers ──────────────────────────────────────────────────
  ipcMain.handle(
    'cli-config:migrate-mcp',
    async (
      _event,
      actions: Array<{ name: string; action: 'skip' | 'overwrite' }>
    ) => {
      console.log('[CliConfig] cli-config:migrate-mcp, items:', actions.length)
      try {
        const ccJsonPath = join(homedir(), '.claude.json')
        if (!(await pathExists(ccJsonPath))) {
          return { success: false, error: '~/.claude.json not found' }
        }

        let ccData: Record<string, unknown>
        try {
          ccData = JSON.parse(await readFile(ccJsonPath, 'utf-8'))
        } catch {
          return { success: false, error: 'Failed to parse ~/.claude.json' }
        }

        const ccServers = (ccData.mcpServers ?? {}) as Record<string, McpServerConfig>
        const haloConfig = getConfig()
        const haloMcpServers: Record<string, McpServerConfig> = { ...(haloConfig.mcpServers ?? {}) }

        const results: Array<{ name: string; status: 'merged' | 'skipped' | 'error'; error?: string }> = []

        for (const { name, action } of actions) {
          if (action === 'skip' || !(name in ccServers)) {
            results.push({ name, status: 'skipped' })
            continue
          }

          try {
            haloMcpServers[name] = ccServers[name]
            console.log(`[CliConfig] Merged MCP server: ${name}`)
            results.push({ name, status: 'merged' })
          } catch (err: unknown) {
            const e = err as Error
            results.push({ name, status: 'error', error: e.message })
          }
        }

        // Persist updated mcpServers to Halo config
        saveConfig({ mcpServers: haloMcpServers })

        const mergedCount = results.filter(r => r.status === 'merged').length
        console.log(`[CliConfig] MCP migration complete: ${mergedCount}/${actions.length} merged`)
        return { success: true, data: { results } }
      } catch (error: unknown) {
        const err = error as Error
        console.error('[CliConfig] migrate-mcp failed:', err.message)
        return { success: false, error: err.message }
      }
    }
  )

  // ── Update config dir mode ───────────────────────────────────────────────
  ipcMain.handle(
    'cli-config:set-config-dir',
    async (
      _event,
      mode: 'halo' | 'cc' | 'custom',
      customDir?: string
    ) => {
      console.log('[CliConfig] cli-config:set-config-dir', mode, customDir)
      try {
        // Validate: custom mode requires a non-empty path
        if (mode === 'custom' && !customDir?.trim()) {
          return { success: false, error: 'A directory path is required when using Custom mode' }
        }

        const resolvedCustomDir = customDir ? resolve(customDir) : undefined

        // Validate custom dir exists
        if (mode === 'custom' && resolvedCustomDir && !(await pathExists(resolvedCustomDir))) {
          return { success: false, error: `Directory does not exist: ${resolvedCustomDir}` }
        }

        const currentConfig = getConfig()
        saveConfig({
          agent: {
            ...currentConfig.agent,
            configDirMode: mode,
            customConfigDir: mode === 'custom' ? resolvedCustomDir : undefined,
          }
        })

        const effectivePath = resolveClaudeConfigDir(mode, resolvedCustomDir)

        console.log(`[CliConfig] Config dir mode set to '${mode}': ${effectivePath}`)
        return {
          success: true,
          data: {
            mode,
            effectivePath,
            customConfigDir: resolvedCustomDir,
          }
        }
      } catch (error: unknown) {
        const err = error as Error
        console.error('[CliConfig] set-config-dir failed:', err.message)
        return { success: false, error: err.message }
      }
    }
  )

  console.log('[CliConfig] CLI config handlers registered')
}
