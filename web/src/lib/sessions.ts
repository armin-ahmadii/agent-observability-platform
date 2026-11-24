// A session's display name: its title (T3's chat name when there is one), else its project folder.
export const sessionName = (s?: { title?: string; project?: string } | null) => s?.title || s?.project || ''
