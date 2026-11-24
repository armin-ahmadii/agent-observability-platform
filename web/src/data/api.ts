// Every call to the local server (server.mjs). GETs return parsed JSON; POSTs never throw.
const get = (path: string) => fetch(path).then(r => r.json())
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
    fetch('/api/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, ...body }) }).catch(() => {}),
  hide: (id: string, unhide = false) =>
    fetch('/api/hide', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, unhide }) }).catch(() => {}),
  // true when the server stored it
  resolve: (sessionId: string, runId: string) =>
    fetch('/api/resolve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, runId }) }).then(r => r.ok, () => false),
  vote: (body: Record<string, unknown>) =>
    fetch('/api/vote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {}),
}
