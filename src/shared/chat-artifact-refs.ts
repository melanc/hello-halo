/**
 * Workspace file/folder references embedded in chat text (renderer + main).
 * Stored as sentinels in saved messages; normalized to markdown code for the agent.
 */

export const DEVX_REF_OPEN = '[[devx-ref:'
export const DEVX_REF_CLOSE = ']]'

export function formatArtifactReference(relativePath: string): string {
  return `${DEVX_REF_OPEN}${encodeURIComponent(relativePath)}${DEVX_REF_CLOSE}`
}

/** Convert sentinels to `path` so the model sees familiar markdown-style paths. */
export function normalizeArtifactRefsForAgent(raw: string): string {
  return raw.replace(/\[\[devx-ref:([^\]]+)\]\]/g, (_m, enc: string) => {
    try {
      return `\`${decodeURIComponent(enc)}\``
    } catch {
      return '`[reference]`'
    }
  })
}

/** Extract every sentinel from text (order preserved). Remaining text is collapsed lightly trimmed. */
export function consumeArtifactRefSentinelsFromText(raw: string): { text: string; paths: string[] } {
  const paths: string[] = []
  const without = raw.replace(/\[\[devx-ref:([^\]]+)\]\]/g, (_m, enc: string) => {
    try {
      const p = decodeURIComponent(enc)
      if (p) paths.push(p)
    } catch {
      /* skip invalid */
    }
    return ' '
  })
  const text = without
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .trim()
  return { text, paths }
}
