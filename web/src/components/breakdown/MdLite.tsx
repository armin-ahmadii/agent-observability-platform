// Handed-back results are Markdown: show **bold**, `code` and one line per bullet; everything else stays plain text.
export function MdLite({ text }: { text: string }) {
  const lines = String(text).replace(/\r/g, '').replace(/\n{3,}/g, '\n\n')
    .split('\n').map(l => l.replace(/^\s*#{1,6}\s+/, '').replace(/^(\s*)[-*+]\s+/, '$1• ')).join('\n')
  // Split into plain text, <code> and <b> runs: code first, then bold inside the rest.
  const out: (string | JSX.Element)[] = []
  let k = 0
  for (const part of lines.split(/(`[^`\n]+`)/g)) {
    if (/^`[^`\n]+`$/.test(part)) { out.push(<code key={k++}>{part.slice(1, -1)}</code>); continue }
    for (const p of part.split(/(\*\*[^*\n]+\*\*)/g)) {
      if (/^\*\*[^*\n]+\*\*$/.test(p)) out.push(<b key={k++}>{p.slice(2, -2)}</b>)
      else if (p) out.push(p)
    }
  }
  return <>{out}</>
}
