// Command-line options. Parsed when first imported (before any store is read), so --help and bad options
// stop the server before it starts anything.
import { parseArgs } from 'node:util'

const DEFAULT_PORT = 4791

const USAGE = `Usage: node server.mjs [--port <number>] [--live <dir>]
       node server.mjs [port] [liveDir]

  --port <number>  Port to serve the dashboard on (default ${DEFAULT_PORT}).
  --live <dir>     The data folder shared with the mod: session files and stores
                   (default: $SUBAGENT_DECK_LIVE if set, else the folder server.mjs is in).
  -h, --help       Show this help.`

// Parses server arguments. Returns { port, liveDir }, { help: true }, or { error }.
// Use either flags or the positional form (port, then folder) that existing launchd jobs use, not both.
export function parseOptions(args) {
  let parsed
  try {
    parsed = parseArgs({
      args,
      options: { port: { type: 'string', short: 'p' }, live: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
      allowPositionals: true,
    })
  } catch (error) {
    return { error: error.message }
  }
  const { values, positionals } = parsed
  if (values.help) return { help: true }
  if ((values.port !== undefined || values.live !== undefined) && positionals.length) {
    return { error: `unexpected argument${positionals.length > 1 ? 's' : ''} after --port/--live: ${positionals.join(' ')}` }
  }
  if (positionals.length > 2) return { error: `too many arguments: ${positionals.join(' ')}` }
  const portText = values.port ?? positionals[0] ?? String(DEFAULT_PORT)
  const port = Number(portText)
  if (!/^\d+$/.test(portText) || port < 1 || port > 65535) return { error: `"${portText}" is not a port number (1-65535).` }
  return { port, liveDir: values.live ?? positionals[1] ?? null }
}

function optionsOrExit(args) {
  const o = parseOptions(args)
  if (o.help) {
    console.log(USAGE)
    process.exit(0)
  }
  if (o.error) {
    console.error(`subagent-deck: ${o.error}\n\n${USAGE}`)
    process.exit(2)
  }
  return o
}

export const options = optionsOrExit(process.argv.slice(2))
