// Extract every TypeSafe tool call and guard notice from a session log.
//
// Reasoning about "did the agent use the plugin well?" from the transcript is
// guesswork: the transcript shows messages, not calls. The session store records
// the actual tool invocations, argument shapes, and results, so the questions
// that matter — how many calls, whether they were batched, which questions were
// asked, whether the guard fired — can be answered from evidence.
//
// Usage: node scripts/audit-session.mjs <sessionId> [--cwd-filter <substring>]

import { resolveSession, recordsFrom } from './lib/session-store.mjs'

const idFragment = process.argv[2]
if (!idFragment) {
  console.error('usage: node scripts/audit-session.mjs <sessionIdFragment>')
  process.exit(2)
}

const target = resolveSession(idFragment)
if (!target) {
  console.error(`No session matching "${idFragment}"`)
  process.exit(2)
}

console.log(`Session dir: ${target.dir}`)
console.log(`Files:       ${target.files.length}\n`)

const records = recordsFrom(target.files)
console.log(`Records: ${records.length}\n`)

/**
 * Walk a record for tool calls. The shape differs by record type, so this
 * collects anything that carries a `name` plus `arguments`, which is what both
 * `tool/call` records and streamed tool-call chunks expose.
 */
const calls = []
const walkCalls = (value, path) => {
  if (Array.isArray(value)) { value.forEach((v, i) => walkCalls(v, `${path}[${i}]`)); return }
  if (!value || typeof value !== 'object') return
  if (typeof value.name === 'string' && value.arguments !== undefined && (value.type === 'tool_use' || value.type === 'tool-call' || value.name.startsWith('typesafe'))) {
    calls.push({ name: value.name, args: value.arguments, path })
  }
  for (const [k, v] of Object.entries(value)) walkCalls(v, `${path}.${k}`)
}
for (const record of records) walkCalls(record, '$')

// De-duplicate: a streamed chunk and its stored message can both carry the call.
const seen = new Set()
const uniqueCalls = []
for (const call of calls) {
  const key = `${call.name}|${typeof call.args === 'string' ? call.args : JSON.stringify(call.args)}`
  if (seen.has(key)) continue
  seen.add(key)
  uniqueCalls.push(call)
}

const byName = {}
for (const call of uniqueCalls) byName[call.name] = (byName[call.name] ?? 0) + 1

console.log('Tool calls by name:')
for (const [name, count] of Object.entries(byName).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${count.toString().padStart(3)}  ${name}`)
}
console.log('')

// ── the typesafe calls in detail ─────────────────────────────────────────────
const tsCalls = uniqueCalls.filter((c) => c.name.startsWith('typesafe_'))
console.log('='.repeat(72))
console.log(`TypeSafe calls: ${tsCalls.length}`)
console.log('='.repeat(72))

for (const [index, call] of tsCalls.entries()) {
  let args = call.args
  if (typeof args === 'string') { try { args = JSON.parse(args) } catch { /* keep string */ } }
  console.log(`\n[${index + 1}] ${call.name}`)
  if (args && typeof args === 'object') {
    if (args.state !== undefined) {
      const state = typeof args.state === 'string' ? args.state : JSON.stringify(args.state)
      console.log(`    state: ${state.length} chars — ${JSON.stringify(state.slice(0, 120))}${state.length > 120 ? '…' : ''}`)
      // A batched call carries many items in one state; count the markers so the
      // batching question is answered from the payload rather than assumed.
      const markers = (state.match(/\b0\d\d\b/gu) ?? []).length
      if (markers > 0) console.log(`    (contains ${markers} numbered feedback markers)`)
    }
    if (args.questions) {
      const ids = Object.keys(args.questions)
      console.log(`    questions: ${ids.length} — ${ids.slice(0, 8).join(', ')}${ids.length > 8 ? ', …' : ''}`)
    }
    if (args.destinations) console.log(`    destinations: ${args.destinations.length}`)
    if (args.min_confidence !== undefined) console.log(`    min_confidence: ${args.min_confidence}`)
    if (args.source !== undefined) console.log(`    source: ${args.source}`)
    const other = Object.keys(args).filter((k) => !['state', 'questions', 'destinations', 'min_confidence', 'source', 'descriptions', 'instructions', 'text'].includes(k))
    if (other.length > 0) console.log(`    other keys: ${other.join(', ')}`)
  } else {
    console.log(`    args: ${String(args).slice(0, 200)}`)
  }
}

// ── guard notices actually delivered ─────────────────────────────────────────
console.log(`\n${'='.repeat(72)}`)
console.log('Guard notices in tool results')
console.log('='.repeat(72))
const guardLines = []
for (const record of records) {
  const text = JSON.stringify(record)
  for (const match of text.matchAll(/\[TypeSafe guard\][^"\\]{0,180}/gu)) guardLines.push(match[0])
}
if (guardLines.length === 0) {
  console.log('  (none — the guard did not annotate any result in this session)')
} else {
  const counts = {}
  for (const line of guardLines) {
    const kind = line.includes('UNSCREENED') || line.includes('Not screened') ? 'not-screened'
      : line.includes('LIKELY PROMPT INJECTION') ? 'blocked'
        : line.includes('Possible injected') ? 'review'
          : line.includes('Screened clear') ? 'clear' : 'other'
    counts[kind] = (counts[kind] ?? 0) + 1
  }
  for (const [kind, count] of Object.entries(counts)) console.log(`  ${count.toString().padStart(3)}  ${kind}`)
  console.log('')
  for (const line of [...new Set(guardLines)].slice(0, 6)) console.log(`  | ${line.slice(0, 150)}`)
}

// ── which fetch-like tools ran (are they all covered by guardTools?) ─────────
console.log(`\n${'='.repeat(72)}`)
console.log('Content-ingesting tools that ran')
console.log('='.repeat(72))
const INGEST = /fetch|read_page|read_url|search|browse|crawl|http/i
const ingestCalls = [...new Set(uniqueCalls.filter((c) => INGEST.test(c.name)).map((c) => c.name))]
for (const name of ingestCalls) console.log(`  ${name}`)
if (ingestCalls.length === 0) console.log('  (none)')
