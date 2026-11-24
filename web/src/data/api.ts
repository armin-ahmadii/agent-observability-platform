// Every call to the local server (server.mjs). GETs return parsed JSON; POSTs never throw.
// Every call gives up after FETCH_TIMEOUT_MS, so one stuck request can't hold the page (the next poll tries again).
const FETCH_TIMEOUT_MS = 5000
const send = (path: string, init?: RequestInit) => fetch(path, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
const post = (path: string, body: unknown) => send(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const get = (path: string) => send(path).then(r => r.json())
const q = (id: string) => '?id=' + encodeURIComponent(id)
export const api = {
  sessions: () => get('/api/sessions'),
  session: (id: string, w = '') => get('/api/session' + q(id) + w),
  math: (id: string, w = '') => get('/api/math' + q(id) + w),
  history: (id: string, w = '') => get('/api/history' + q(id) + w),
  chats: (w: string) => get('/api/chats?' + w.slice(1)),
  mcpHistory: (id: string) => get('/api/mcp-history' + q(id)),
  memory: (id: string) => get('/api/memory' + q(id)),
  grades: () => get('/api/grades'),
  titles: () => get('/api/titles'),
  done: () => get('/api/done'),
  action: (sessionId: string, body: Record<string, unknown>) =>
    post('/api/action', { sessionId, ...body }).catch(() => {}),
  hide: (id: string, unhide = false) =>
    post('/api/hide', { id, unhide }).catch(() => {}),
  // true when the server stored it
  resolve: (sessionId: string, runId: string) =>
    post('/api/resolve', { sessionId, runId }).then(r => r.ok, () => false),
  vote: (body: Record<string, unknown>) =>
    post('/api/vote', body).catch(() => {}),
}
