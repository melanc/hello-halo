/**
 * KB Writer - Background agent for writing conversation insights to the knowledge base
 *
 * Spawned after each completed pipeline session when a knowledge base is configured.
 * Runs as a fire-and-forget background agent in the KB space directory.
 * Emits `agent:kb-write-complete` broadcast when finished.
 *
 * Writes two categories of files:
 *   - 变更日志/YYYYMMDD-{taskName}.md  — per-task change log
 *   - 项目介绍/{projectName}技术知识.md — project knowledge (updated if relevant)
 */

import { randomUUID } from 'crypto'
import { unstable_v2_createSession } from '@anthropic-ai/claude-agent-sdk'
import { getConfig } from '../config.service'
import { getApiCredentials, getHeadlessElectronPath } from './helpers'
import { resolveCredentialsForSdk, buildBaseSdkOptions } from './sdk-config'
import { emitAgentBroadcast } from './events'

// ============================================
// Public API
// ============================================

export interface KbWriteRequest {
  /** KB space ID (for SDK workDir resolution) */
  kbSpaceId: string
  /** Absolute path to the KB root directory */
  kbRootPath: string
  /** Task name — used in the change log filename */
  taskName: string
  /** Pre-formatted task context (requirement, dev plan, subtasks) */
  taskContext: string
  /** Top-level project directories involved in this task */
  projectDirs: string[]
}

/**
 * Trigger a background KB write after a pipeline session completes.
 * Fire-and-forget: errors are caught and broadcast as failure events.
 */
export function triggerKbWrite(request: KbWriteRequest): void {
  _runKbWrite(request).catch((err) => {
    console.error('[KbWriter] Background write failed:', err)
    emitAgentBroadcast('agent:kb-write-complete', {
      success: false,
      taskName: request.taskName,
      error: String(err),
    })
  })
}

// ============================================
// Internal Implementation
// ============================================

async function _runKbWrite(request: KbWriteRequest): Promise<void> {
  const { kbSpaceId, kbRootPath, taskName, taskContext, projectDirs } = request
  const runTag = randomUUID().slice(0, 8)

  console.log(`[KbWriter][${runTag}] Starting KB write for task: "${taskName}"`)

  const config = getConfig()
  const credentials = await getApiCredentials(config)
  const resolvedCredentials = await resolveCredentialsForSdk(credentials)
  const electronPath = getHeadlessElectronPath()
  const abortController = new AbortController()

  const sdkOptions = buildBaseSdkOptions({
    credentials: resolvedCredentials,
    workDir: kbRootPath,
    electronPath,
    spaceId: kbSpaceId,
    conversationId: `kb-write-${runTag}`,
    abortController,
    stderrHandler: (data: string) => {
      console.error(`[KbWriter][${runTag}] stderr:`, data)
    },
    mcpServers: null,
    maxTurns: 20,
  })

  // Disable token-level streaming — not needed for background writes
  sdkOptions.includePartialMessages = false

  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const safeTaskName = taskName.replace(/[/\\:*?"<>|]/g, '-').slice(0, 40)
  const changeLogRelPath = `变更日志/${date}-${safeTaskName}.md`

  const prompt = buildKbWritePrompt({
    taskName,
    taskContext,
    projectDirs,
    changeLogRelPath,
    date,
  })

  let session: any = null
  try {
    session = await unstable_v2_createSession(sdkOptions as any)
    console.log(`[KbWriter][${runTag}] Session created, sending prompt`)

    const finalText = await runStream(session, prompt, abortController, runTag)
    console.log(`[KbWriter][${runTag}] KB write completed. Summary: ${finalText.slice(0, 200)}`)

    emitAgentBroadcast('agent:kb-write-complete', {
      success: true,
      taskName,
    })
  } finally {
    if (session) {
      try { session.close?.() } catch {}
    }
  }
}

/**
 * Process the V2 session stream, returning the final text output.
 * Intentionally minimal — no renderer events, no conversation persistence.
 */
async function runStream(
  session: any,
  message: string,
  abortController: AbortController,
  tag: string
): Promise<string> {
  let finalText = ''

  session.send(message)

  for await (const sdkMessage of session.stream()) {
    if (abortController.signal.aborted) {
      console.log(`[KbWriter][${tag}] Aborted`)
      break
    }
    if (!sdkMessage || typeof sdkMessage !== 'object') continue

    if (sdkMessage.type === 'assistant') {
      const content = sdkMessage.message?.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text' && typeof block.text === 'string') {
            finalText = block.text  // Take last text block as final output
          }
          if (block.type === 'tool_use') {
            console.log(`[KbWriter][${tag}] Tool: ${block.name}`)
          }
        }
      }
    }

    if (sdkMessage.type === 'result') {
      break
    }
  }

  return finalText
}

// ============================================
// Prompt Builder
// ============================================

function buildKbWritePrompt(params: {
  taskName: string
  taskContext: string
  projectDirs: string[]
  changeLogRelPath: string
  date: string
}): string {
  const { taskName, taskContext, projectDirs, changeLogRelPath, date } = params

  const projectsLine = projectDirs.length > 0
    ? projectDirs.join('、')
    : '（从任务信息中提取）'

  const lines: string[] = [
    '你是知识库整理助手。请根据以下已完成的任务信息，向知识库写入结构化记录。',
    '注意：这是后台自动执行，写入文件时无需等待用户确认，直接操作即可。',
    '',
    '--- 任务信息 ---',
    taskContext,
    '--- 任务信息结束 ---',
    '',
    '请按以下步骤操作：',
    '',
    '**步骤 1：写入变更日志**',
    `- 文件路径（相对当前目录）：${changeLogRelPath}`,
    '- 如目录不存在，先用 Bash 命令 `mkdir -p 变更日志` 创建',
    '- 使用 Write 工具写入，内容格式如下：',
    '',
    '```markdown',
    `# ${taskName} — ${date}`,
    '',
    '## 需求摘要',
    '（根据任务信息提炼 2-4 句核心内容）',
    '',
    '## 涉及项目',
    projectsLine,
    '',
    '## 主要改动',
    '（根据开发计划和子任务，列出主要改动点，每条一行）',
    '',
    '## 经验教训',
    '（本次遇到的问题和解决方案；无则写"无"）',
    '```',
    '',
    '**步骤 2：更新项目介绍（仅更新本次涉及的项目）**',
    '- 对每个涉及的项目，检查 `项目介绍/{项目名}技术知识.md` 是否存在',
    '- 如文件已存在：用 Read 读取后，将本次新增的技术知识追加到文件末尾（仅追加不重复的内容）',
    '- 如文件不存在：仅当本次任务信息中包含明确的接口/模块/架构知识时才创建，否则跳过',
    '',
    '完成后输出一行简要说明（写入了哪些文件）。',
  ]

  return lines.join('\n')
}
