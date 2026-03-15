# Halo Architecture

> For AI developers: Read this file to understand the project's complete technical architecture.
> Primary source of truth for structure, conventions, and contracts.

## 1) Layer Model

```
User Interaction Layer
  - Renderer pages/components/stores
  - Desktop UI and remote web UI

Apps Layer (src/main/apps)
  - spec            : App YAML parse + validate
  - manager         : install/config/status persistence
  - runtime         : activation/execution/activity/escalation
  - conversation-mcp: in-process MCP server for app management tools
  - store-index     : planned

Platform Layer (src/main/platform)
  - store       : SQLite manager + migrations foundation
  - scheduler   : persistent job engine
  - event       : event routing/filter/dedup
  - memory      : scoped memory tools + files
  - background  : keep-alive + tray + daemon browser

Services Layer (src/main/services)
  - existing domain services (agent, ai-browser, space, conversation, remote, etc.)
```

## 2) Dependency Direction (Must Hold)

- Dependencies flow downward only: `UI -> apps -> platform -> services/utilities`.
- `apps/runtime` is the orchestration boundary; do not push runtime orchestration into transport layers.
- `platform/*` modules stay generic infrastructure (not renderer-specific, not UI-coupled).
- Shared renderer-safe types belong in `src/shared/apps/*`.

## 3) Engineering Baseline (Non-Negotiable)

- **Modularity and boundary clarity are mandatory.**
- **High quality and maintainability are first priority.**
- **Performance must be preserved or improved** — no startup/runtime/memory regressions.
- Essential startup path remains minimal; heavy work stays in extended/lazy flows.

## 4) Directory Structure

```
src/
├── main/                              # Electron Main Process
│   ├── index.ts                       # Main entry, app lifecycle
│   ├── bootstrap/                     # essential.ts (sync) + extended.ts (async)
│   ├── controllers/                   # Business logic shared by IPC & HTTP
│   ├── http/                          # Remote Access: Express + WebSocket + routes/
│   ├── ipc/                           # IPC handlers (20 modules, one per domain)
│   ├── apps/                          # Apps Layer (spec, manager, runtime, conversation-mcp)
│   ├── platform/                      # Platform Layer (store, scheduler, event, memory, background)
│   ├── openai-compat-router/          # Anthropic <-> OpenAI bridge
│   └── services/                      # Domain services
│       ├── agent/                     # Agent engine (session, MCP, permissions, streaming)
│       ├── ai-browser/               # AI Browser + tools/
│       ├── ai-sources/               # Multi-provider auth + providers/
│       ├── health/                   # Health monitoring & recovery
│       ├── notify-channels/          # External notification channels
│       ├── web-search/               # Web search MCP server
│       ├── perf/                     # Performance monitoring
│       ├── stealth/                  # Anti-detection evasions
│       └── *.service.ts              # Individual services (config, space, conversation, etc.)
│
├── worker/                            # Utility processes (file-watcher)
├── shared/                            # Cross-process types, constants, protocols
│   ├── types/                         # ai-sources, artifact, health, notification-channels
│   ├── apps/                          # app-types, spec-types
│   └── constants/                     # providers, ignore-patterns
│
├── preload/
│   └── index.ts                       # Exposes HaloAPI to renderer (source of truth for IPC)
│
└── renderer/                          # React Frontend
    ├── App.tsx, main.tsx
    ├── api/                           # Unified API adapter (IPC or HTTP transport)
    ├── pages/                         # HomePage, SpacePage, SettingsPage, AppsPage
    ├── components/                    # UI components by domain:
    │   ├── apps/                      #   Apps management
    │   ├── canvas/                    #   Content Canvas + viewers/
    │   ├── chat/                      #   Chat stream + tool-result/
    │   ├── layout/                    #   Header, ModelSelector, SpaceSelector, etc.
    │   ├── settings/                  #   Settings sections
    │   ├── store/                     #   App Store UI
    │   ├── diff/, search/, pulse/, setup/, onboarding/, artifact/, ...
    │   └── (no separate ui/ dir — uses Tailwind directly)
    ├── stores/                        # Zustand (11 stores)
    ├── hooks/                         # useIsMobile, useCanvasLifecycle, useLayoutPreferences, etc.
    ├── types/index.ts                 # All shared renderer types (~740 lines)
    ├── lib/                           # utils (cn()), codemirror, highlight, perf
    ├── i18n/                          # Internationalization
    └── assets/styles/                 # globals.css, syntax-theme.css, canvas-tabs.css, browser-task-card.css
```

## 5) Data Types

**Primary source**: `src/renderer/types/index.ts` + `src/shared/types/`

Key types:

| Type | Description |
|------|-------------|
| `HaloConfig` | App config: `api`, `aiSources`, `permissions`, `appearance`, `system`, `remoteAccess`, `mcpServers`, `notifications`, `notificationChannels`, `agent`, `layout`, `chat` |
| `AISourcesConfig` | Multi-provider v2 format: `version`, `currentId`, `sources[]` |
| `ConversationMeta` | Lightweight list item (no messages) |
| `Conversation` | Full conversation with `messages`, `sessionId`, `version` |
| `Message` | Contains `content`, `toolCalls`, `thoughts` (null=separated), `images`, `tokenUsage`, `thoughtsSummary`, `metadata.fileChanges`, `error` |
| `Thought` | Agent reasoning: `thinking`, `text`, `tool_use`, `tool_result`, `system`, `result`, `error` |
| `ThoughtsSummary` | Lightweight summary: `count`, `types`, `duration` (for collapsed display without loading thoughts) |
| `ToolCall` | Tool invocation: `id`, `name`, `status`, `input`, `output`, `requiresApproval`, `description` |
| `Artifact` / `ArtifactTreeNode` | Files in space |
| `Space` | `id`, `name`, `icon`, `path`, `isTemp`, `workingDir?`, `preferences?` |
| `McpServerConfig` | MCP server: `stdio` / `http` / `sse` types |
| `CanvasContext` | AI awareness of open Canvas tabs |
| `PulseItem` / `TaskStatus` | Pulse panel task status tracking |
| `PendingQuestion` / `Question` | AskUserQuestion types |
| `TokenUsage` | Token usage stats: input/output/cache/cost |
| `CompactInfo` | Context compression notification |
| `FileChangesSummary` | Lightweight file changes in message metadata |

**Three-state `thoughts` field** in Message:
- `undefined` = no thoughts
- `null` = stored separately (not loaded yet)
- `Thought[]` = loaded or inline

## 6) IPC Channels

**Source of truth**: `src/preload/index.ts` (~790 lines). Read it for the complete channel list.

### Naming Convention

All channels follow `module:action` format. Modules: `auth`, `config`, `ai-sources`, `space`, `conversation`, `agent`, `artifact`, `search`, `browser`, `ai-browser`, `canvas`, `overlay`, `remote`, `system`, `window`, `updater`, `perf`, `git-bash`, `bootstrap`, `health`, `notify-channels`, `notification`, `app`, `store`, `onboarding`.

Two types:
- **Request/Response** (renderer → main): registered via `ipcMain.handle()`
- **Events** (main → renderer): pushed via `sendToRenderer()` / `broadcastToAll()`

### IPC Sync Checklist (Critical)

When adding a new IPC channel, update these files in sync:

| Action | Files |
|--------|-------|
| **New request API** | main handler (`ipc/*.ts`) + `preload/index.ts` + `renderer/api/index.ts` + HTTP route if remote-capable |
| **New event channel** | emitter in main + `preload/index.ts` listener + `renderer/api/transport.ts` methodMap + `renderer/api/index.ts` |

**Missing any of these will cause events to silently not reach the renderer process.**

## 7) State Flow & Multi-Platform Architecture

### Data Flow

```
Renderer (UI)
  → api adapter (IPC in Electron, HTTP in Web)
  → Main Process (controllers/services)
  → Agent Loop (@anthropic-ai/claude-code)
  → Events (IPC or WebSocket for remote)
  → UI Update
```

### Multi-Platform

```
┌──────────────────────────────────────────────────────────┐
│                     Electron App                          │
│  ┌──────────┐    ┌──────────┐    ┌──────────────────┐    │
│  │ Renderer │    │   Main   │    │   HTTP Server    │    │
│  │ (React)  │◄──►│ Process  │◄──►│   (Express)      │    │
│  │          │IPC │          │    │ ┌──────────────┐  │    │
│  └──────────┘    └──────────┘    │ │  WebSocket   │  │    │
│                                  │ │  REST API    │  │    │
│                                  └──────────────────┘    │
└──────────────────────────────────────────────────────────┘
                           ▲
                           │ HTTP/WS
                           ▼
┌──────────────────────────────────────────────────────────┐
│                  Remote Web Client                        │
│  Same React App                                          │
│  api adapter: isElectron() ? IPC : HTTP                  │
└──────────────────────────────────────────────────────────┘
```

### API Adapter Pattern

```typescript
// src/renderer/api/index.ts
export const api = {
  getConfig: async () => {
    if (isElectron()) return window.halo.getConfig()  // IPC
    return httpRequest('GET', '/api/config')           // HTTP
  }
}
```

### Authentication (Remote)

1. Server generates 6-digit PIN on start
2. User enters PIN on login page → receives Token
3. Token stored in localStorage
4. All API requests include `Authorization: Bearer <token>`
5. On 401, auto-clear token and redirect to login

### WebSocket Events (Remote)

- Subscribe: `{ type: 'subscribe', payload: { conversationId } }`
- Receive: `{ type: 'event', channel: 'agent:thought', data: {...} }`

### Web Mode Limitations

Some features are disabled in web mode:
- Open file/folder (cannot access local filesystem)
- Artifact click-to-open → shows "Please open in desktop client" hint
- If a feature supports Web mode, handle the corresponding adapter and interface properly

## 8) Service Inter-Communication

Services use a **callback registration pattern** to avoid circular dependencies:

- `config.service.ts` provides `onApiConfigChange(callback)` registration
- `agent` service registers the callback at module load
- When API config changes (provider/apiKey/apiUrl), agent is automatically notified to clean up all V2 Sessions
- User's next message automatically creates a new Session with the updated config

**BrowserWindow lifecycle**: Always check `!mainWindow.isDestroyed()` before accessing `mainWindow`, especially in async callbacks and event listeners (the window may already be destroyed).

## 9) Content Canvas & Layout

### Components

```
ContentCanvas.tsx          # Main container + tab switching
├── CanvasTabs.tsx         # Tab bar (VS Code style)
└── viewers/
    ├── CodeViewer.tsx     # CodeMirror 6 with syntax highlighting
    ├── MarkdownViewer.tsx # react-markdown
    ├── HtmlViewer.tsx     # iframe srcdoc (avoids CSP issues)
    ├── ImageViewer.tsx    # Zoom/pan
    ├── JsonViewer.tsx     # Format/minify
    ├── CsvViewer.tsx      # Table view
    ├── TextViewer.tsx
    └── BrowserViewer.tsx  # Live web pages
```

### Layout Modes

- **No Canvas**: Full-width chat
- **With Canvas**: Narrow chat (user-configurable, stored in space preferences) + Canvas + ArtifactRail

### Interface Layout

- **Left sidebar**: Conversation list (collapsible)
- **Center**: Chat Stream (conversation flow)
- **Right**: Content Canvas (content preview) + Artifact Rail (file list)

### Technical Decisions

- **HTML preview**: Uses `<iframe srcdoc>` instead of blob URLs (avoids CSP restrictions)
- **Fullscreen**: Calls `BrowserWindow.maximize()` for window-level maximization

## 10) AI Browser Module

AI-controlled embedded browser for web automation. Uses Electron BrowserView + CDP.

### 26+ Browser Tools

| Category | Tools |
|----------|-------|
| Navigation | `browser_new_page`, `browser_navigate`, `browser_list_pages`, `browser_select_page`, `browser_close_page`, `browser_wait_for` |
| Input | `browser_click`, `browser_fill`, `browser_fill_form`, `browser_hover`, `browser_drag`, `browser_press_key`, `browser_upload_file`, `browser_handle_dialog` |
| Snapshot | `browser_snapshot` (core!), `browser_screenshot`, `browser_evaluate` |
| Debug | `browser_console`, `browser_network_requests`, `browser_network_request` |
| Emulation | `browser_emulate`, `browser_resize` |
| Performance | `browser_perf_start`, `browser_perf_stop`, `browser_perf_insight` |
| Script | `browser_execute_script` |

### Accessibility Tree (Core Innovation)

- Uses CDP `Accessibility.getFullAXTree` for page structure
- Each interactive element gets a unique UID (e.g., `snap_1_42`)
- AI references elements by UID — no CSS selectors needed
- Lower token cost than DOM parsing

## 11) Theme System

CSS variable-based theming. **Do not use hardcoded colors.**

- Follows shadcn/ui design pattern
- Uses CSS variables (`--background`, `--foreground`, `--primary`, etc.)
- Components reference colors via `hsl(var(--xxx))`
- Default system theme (respects OS preference), `.light` / `.dark` class overrides

```css
/* Correct */
bg-background, text-foreground, border-border
hsl(var(--primary)), hsl(var(--muted-foreground))

/* NEVER */
#ffffff, rgb(0,0,0), bg-gray-100, text-white (except on explicitly colored backgrounds)
```

Theme switch: `<html>` class toggle in `App.tsx`
Anti-flash: `index.html` inline script reads `localStorage('halo-theme')`

## 12) CSS Architecture: Tailwind First

**Use Tailwind by default.** Only use CSS files for what Tailwind can't handle:
- `@keyframes` animations
- Complex `::before` / `::after` pseudo-elements
- Nested selectors (`.parent:hover .child`)
- Third-party library overrides (e.g., highlight.js)

```
src/renderer/assets/styles/
├── globals.css           # Theme variables, @keyframes, base styles
├── syntax-theme.css      # highlight.js syntax colors
├── canvas-tabs.css       # VS Code style tab bar
└── browser-task-card.css # AI Browser effects
```

Do not create new CSS files unless the above exceptions apply.

## 13) Responsive Design (Mandatory)

**Web mode requires consideration of different platform displays.** This is non-negotiable for all UI changes.

- **Unified mobile breakpoint**: Use Tailwind's `sm:` breakpoint (640px) as the boundary between mobile and desktop
- **Prefer Tailwind responsive classes**: Use `sm:`, `md:`, `lg:`, etc.; minimize JavaScript detection logic
- **Mobile-first adaptation**: Focus on mobile adaptation (< 640px); large screens are not a priority
- **Web and Electron consistency**: Web browser and Electron desktop share the same responsive solution
- **Hook**: `useIsMobile()` hook exists for cases where JS detection is needed (avoid when Tailwind classes suffice)

```tsx
/* Correct: responsive with Tailwind */
<div className="flex flex-col sm:flex-row gap-2 sm:gap-4">
<div className="w-full sm:w-80 sm:min-w-[320px]">
<div className="hidden sm:block">  /* desktop only */
<div className="sm:hidden">         /* mobile only */

/* Wrong: no responsiveness */
<div className="flex flex-row gap-4">
<div className="w-80">
```

## 14) OpenAI Compatible Mode

When `provider = openai`:

```
SDK (Anthropic format)
  → openai-compat-router (localhost)
  → Convert to OpenAI /v1/chat/completions
  → External OpenAI-compatible API
  → Convert response back to Anthropic format
  → SDK receives standard response
```

Location: `src/main/openai-compat-router/`

## 15) Local Storage Layout

```
~/.halo/
├── config.json                 # Global config (API/permissions/theme/remote access/etc.)
├── spaces-index.json           # Space ID -> path registry (v2 format)
├── temp/                       # Halo temporary space (id: halo-temp)
│   ├── artifacts/
│   └── conversations/
└── spaces/                     # All dedicated spaces (centralized storage)
    └── <uuid>/                 # Space identified by UUID
        └── .halo/
            ├── meta.json       # Space metadata (id/name/icon/timestamps/workingDir)
            └── conversations/
                ├── <id>.json           # Conversation data (lightweight, no thoughts)
                └── <id>.thoughts.json  # Separated thoughts data (lazy-loaded)
```

### Space Path Architecture

Spaces have two distinct paths:
- **`path`** (data path): Always centralized under `~/.halo/spaces/{uuid}/`. Used for conversations, meta.json, and all persisted data.
- **`workingDir`** (optional): The user's project directory for custom/project-linked spaces. Used as agent cwd, artifact scanning root, and file explorer target.

For default spaces (no custom path), `workingDir` is undefined and `path` serves both purposes.

Notes:
- **Legacy custom-path spaces**: Created before centralized storage, `path` points to the project directory with `.halo/` inside it. These continue to work without migration.
- **Lazy-loaded conversations**: `conversation.service.ts` uses `index.json` for fast listing; full conversation data is loaded only when entering a conversation.
- **Thoughts separation**: Thoughts data (~97% of file size) stored in separate `.thoughts.json` files, loaded on-demand when user clicks to expand.

## 16) Startup / Shutdown Lifecycle

### Startup phases

1. `app.whenReady()` creates window and initializes core app directories.
2. `initializeEssentialServices()` runs synchronously for first-screen features.
3. After `ready-to-show`, `initializeExtendedServices()` registers deferred handlers/services.
4. `initializeExtendedServices()` triggers `initPlatformAndApps()` asynchronously:
   - Phase 0: `initStore()`
   - Phase 1 (parallel): `initScheduler({ db })`, `initEventBus()`, `initMemory()`
   - Source wiring: register `FileWatcherSource` to event-bus
   - Phase 2: `initAppManager({ db })`
   - Phase 3: `initAppRuntime({ db, appManager, scheduler, eventBus, memory, background })`
   - Start loops only after wiring: `scheduler.start()`, `eventBus.start()`

### Shutdown behavior

- `before-quit` calls `cleanupExtendedServices()` via bootstrap shutdown flow.
- `window-all-closed` keeps process alive when `background.shouldKeepAlive()` is true.
- Cleanup order includes runtime/manager, platform modules, background, and cache cleanup.

## 17) Integration Surfaces

- **IPC handlers**: `src/main/ipc/*.ts` (Apps entry: `src/main/ipc/app.ts`, Store entry: `src/main/ipc/store.ts`)
- **HTTP routes**: `src/main/http/routes/index.ts`
- **WebSocket broadcast**: `src/main/http/websocket.ts`
- **Preload bridge**: `src/preload/index.ts` (`window.halo` contract)
- **Renderer unified API**: `src/renderer/api/index.ts`
- **Renderer transport mode switch**: `src/renderer/api/transport.ts`

Desktop mode: renderer -> preload -> IPC -> main.
Remote mode: renderer -> HTTP/WS -> main.

## 18) Logging

**Production logging requirements:**
- **Must ensure full-process logging in production** to trace every execution stage
- Log all process stages and execution steps throughout the entire flow
- Include timestamps, context information, and error stack traces
- Use structured logging for easier filtering and analysis
- Keep logging lightweight — avoid any unnecessary computation solely for log output

## 19) Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Electron 29 |
| UI | React 18 + TailwindCSS 3.4 |
| State | Zustand 4.5 |
| i18n | i18next 25.7 |
| Code Editor | CodeMirror 6 |
| Markdown | react-markdown 10 + remark-gfm + rehype-highlight |
| Diff | diff + react-diff-viewer-continued |
| HTTP | Express 5 |
| WebSocket | ws 8 |
| Agent | @anthropic-ai/claude-code (claude-agent-sdk) |
| Icons | lucide-react |
| Build | electron-vite 2 + Vite 5 |

## 20) Known Contract Gaps

No known contract gaps at this time. All previously documented HTTP route gaps for App endpoints have been implemented.

## 21) Deep-Dive Module Docs

When touching a module, read its design doc first:
- `src/main/apps/spec/DESIGN.md`
- `src/main/apps/manager/DESIGN.md`
- `src/main/apps/runtime/DESIGN.md`
- `src/main/platform/store/DESIGN.md`
- `src/main/platform/scheduler/DESIGN.md`
- `src/main/platform/memory/DESIGN.md`
- `src/main/platform/background/DESIGN.md`
