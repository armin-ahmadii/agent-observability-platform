// Browser storage that never throws (private windows, blocked site data).
export function readJSON<T>(store: 'session' | 'local', key: string, fallback: T): T {
  try {
    const s = (store === 'session' ? sessionStorage : localStorage).getItem(key)
    return s == null ? fallback : (JSON.parse(s) as T)
  } catch { return fallback }
}
export function writeJSON(store: 'session' | 'local', key: string, value: unknown) {
  try { (store === 'session' ? sessionStorage : localStorage).setItem(key, JSON.stringify(value)) } catch {}
}
export function readSession(key: string) { try { return sessionStorage.getItem(key) } catch { return null } }
export function writeSession(key: string, v: string) { try { sessionStorage.setItem(key, v) } catch {} }
