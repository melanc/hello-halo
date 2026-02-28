/**
 * SlashCommandItem - Represents a single entry in the slash-command autocomplete menu.
 *
 * The list is built in ChatView by merging three sources:
 *  1. SDK init `slash_commands` array  → category 'builtin'
 *  2. SDK init `agents` array          → category 'agent'
 *  3. Installed enabled skills from the apps store → category 'skill'
 */
export interface SlashCommandItem {
  /** Stable unique key for React rendering (e.g. "builtin-compact") */
  id: string
  /** Full command string including the leading slash, e.g. "/compact" */
  command: string
  /** Short display label without the slash, e.g. "compact" */
  label: string
  /** One-line description shown as secondary text in the menu */
  description?: string
  /** Category controls grouping and icon choice in the menu */
  category: 'builtin' | 'skill' | 'agent'
}

/**
 * Raw session-info payload forwarded from the SDK system:init message.
 * Stored in the chat store per conversation and consumed by ChatView.
 */
export interface SessionInitInfo {
  /** Built-in slash commands registered by Claude Code (e.g. ["compact", "review"]) */
  slashCommands: string[]
  /** Active skill slugs in this session (e.g. ["research-lookup"]) */
  skills: string[]
  /** Available agent types (e.g. ["general-purpose", "Explore"]) */
  agents: string[]
}
