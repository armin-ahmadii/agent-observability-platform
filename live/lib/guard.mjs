// Keeps the dashboard's API to the page itself. The server listens on 127.0.0.1 only, but a web page in any
// browser tab could still reach it: by renaming its own domain to 127.0.0.1 (DNS rebinding, caught by the Host
// check) or by posting a simple form (caught by the Origin and content-type checks).

export const MAX_BODY_BYTES = 1 << 20 // 1 MB; the page's largest post (a batch of done-lists) is far below

const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]']

export const allowedHosts = port => LOCAL_HOSTNAMES.map(h => `${h}:${port}`)

// Why a request must be refused ({ status, reason }), or null when it may go ahead.
// `headers`: Node's lower-cased request headers.
export function refusal({ method, headers }, port) {
  const host = String(headers.host ?? '').toLowerCase()
  if (!allowedHosts(port).includes(host)) return { status: 421, reason: 'unknown host' }
  if (method !== 'POST') return null
  // Browsers send Origin on every cross-site POST; the page's own posts carry this same host.
  if (headers.origin !== undefined && headers.origin.toLowerCase() !== `http://${host}`) return { status: 403, reason: 'cross-origin request' }
  // A plain form or a no-cors fetch can't send application/json without the browser asking first (CORS).
  const type = String(headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
  if (type !== 'application/json') return { status: 415, reason: 'expected application/json' }
  if (Number(headers['content-length'] ?? 0) > MAX_BODY_BYTES) return { status: 413, reason: 'body too large' }
  return null
}
