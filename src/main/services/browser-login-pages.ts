/**
 * Login-window inline pages.
 *
 * Builds themed `data:text/html` URLs for the loading spinner and
 * error-with-retry pages shown inside standalone login BrowserWindows.
 *
 * Lives in services/ alongside browser-view.service.ts because it is
 * domain logic (page rendering), not IPC transport.
 */

// ── Theme ────────────────────────────────────────────────────────────

const THEME = {
  light: { bg: '#fafafa', text: '#333', muted: '#aaa', track: '#e0e0e0', spinner: '#666', btn: '#e8e8e8', btnHover: '#ddd' },
  dark:  { bg: '#1a1a1a', text: '#ccc', muted: '#666', track: '#333', spinner: '#a0a0a0', btn: '#333', btnHover: '#444' },
} as const

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'

// ── Helpers ──────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function safeHostname(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

function toDataUrl(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

// ── Public API ───────────────────────────────────────────────────────

/** Background color matching the loading page, for BrowserWindow init. */
export function loginPageBg(isDark: boolean): string {
  return isDark ? THEME.dark.bg : THEME.light.bg
}

/**
 * Inline loading page: centered spinner + target hostname.
 * Renders near-instantly as a data: URL so `ready-to-show` fires
 * without waiting for any network request.
 */
export function buildLoginLoadingPage(targetUrl: string, title: string, isDark: boolean): string {
  const t = isDark ? THEME.dark : THEME.light
  const host = escapeHtml(safeHostname(targetUrl))

  return toDataUrl(/* html */`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box }
    html, body { height: 100%; overflow: hidden }
    body {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: ${t.bg};
      font-family: ${FONT};
      -webkit-user-select: none;
      user-select: none;
    }
    .spinner {
      width: 24px;
      height: 24px;
      border: 2px solid ${t.track};
      border-top-color: ${t.spinner};
      border-radius: 50%;
      animation: spin .65s linear infinite;
      will-change: transform;
    }
    @keyframes spin { to { transform: rotate(360deg) } }
    .hostname {
      margin-top: 14px;
      font-size: 12px;
      color: ${t.muted};
      letter-spacing: .02em;
    }
  </style>
</head>
<body>
  <div class="spinner"></div>
  <div class="hostname">${host}</div>
</body>
</html>`)
}

/**
 * Inline error page with Retry button.
 * Shown when the target URL fails to load (DNS, timeout, etc.).
 */
export function buildLoginErrorPage(targetUrl: string, errorMsg: string, isDark: boolean): string {
  const t = isDark ? THEME.dark : THEME.light
  const host = escapeHtml(safeHostname(targetUrl))
  const safeErr = escapeHtml(errorMsg)
  // encodeURIComponent does NOT encode single-quotes — escape manually to
  // prevent breaking out of the JS string literal in the Retry handler.
  const encUrl = encodeURIComponent(targetUrl).replace(/'/g, '%27')

  return toDataUrl(/* html */`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Error</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box }
    html, body { height: 100%; overflow: hidden }
    body {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 10px;
      background: ${t.bg};
      font-family: ${FONT};
      -webkit-user-select: none;
      user-select: none;
    }
    .error-title {
      font-size: 14px;
      font-weight: 500;
      color: ${t.text};
    }
    .error-detail {
      font-size: 11px;
      color: ${t.muted};
      max-width: 360px;
      text-align: center;
      line-height: 1.5;
      word-break: break-word;
    }
    .retry-btn {
      margin-top: 6px;
      padding: 6px 24px;
      border: none;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      background: ${t.btn};
      color: ${t.text};
      transition: background .15s ease;
    }
    .retry-btn:hover { background: ${t.btnHover} }
    .retry-btn:active { transform: scale(.97) }
  </style>
</head>
<body>
  <div class="error-title">${host}</div>
  <div class="error-detail">${safeErr}</div>
  <button class="retry-btn" id="retry">Retry</button>
  <script>
    document.getElementById('retry').onclick = function () {
      location.href = decodeURIComponent('${encUrl}')
    }
  </script>
</body>
</html>`)
}
