// All sessions prefixes every run id with "<session>:"; this is the id inside its own session.
export const localId = (r: { id: string; sessionOf?: string }) => r.sessionOf ? String(r.id).slice(r.sessionOf.length + 1) : String(r.id)
