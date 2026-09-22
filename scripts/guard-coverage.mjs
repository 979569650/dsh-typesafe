// Pair each guard notice with the tool call it screened, by reading the tool
// RESULT records in order rather than guessing from a shared JSON blob.
//
// The earlier pairing attempt searched a whole record for a tool name, and tool
// name and result are stored in different places, so every pair came back
// "(unknown)". This walks the actual tool/result records in sequence so a gap —
// a content-ingesting tool that ran without any notice — can be stated with
// evidence instead of inferred.
//
// Usage: node scripts/guard-coverage.mjs <sessionIdFragment>

import { resolveSession, recordsFrom } from './lib/session-store.mjs'

const fragment = process.argv[2]
if (!fragment) {
  console.error('usage: node scripts/guard-coverage.mjs <sessionIdFragment>')
  process.exit(2)
}
const target = resolveSession(fragment)
if (!target) { console.error('session not found'); process.exit(2) }

const records = recordsFrom(target.files)

// Build an ordered list of (toolName, resultText) by tracking each tool/call's
// id and matching it to the tool/result that carries the same id.
const callNamesById = new Map()
const results = []

const walk = (value) => {
  if (Array.isArray(value)) { value.forEach(walk); return }
  if (!value || typeof value !== 'object') return
  const type = value.type ?? value.kind
  // A tool call: carries a name and an id.
  if (typeof value.name === 'string' && /tool[-_]?use|tool[-_]?call/u.test(String(type)) && value.id) {
    callNamesById.set(value.id, value.name)
  }
  // A tool result: carries an id and content.
  if (/tool[-_]?result/u.test(String(type)) && value.tool_use_id) {
    const text = JSON.stringify(value.content ?? value)
    results.push({ id: value.tool_use_id, text })
  }
  for (const v of Object.values(value)) walk(v)
}
for (const record of records) walk(record)

// Some logs store the result inline with the call id; also collect by scanning
// for the guard marker and looking backwards for the nearest call id.
const ordered = []
for (const record of records) {
  const text = JSON.stringify(record)
  const guard = /\[TypeSafe guard\] ([^"\\]{0,80})/u.exec(text)
  if (!guard) continue
  const ids = [...text.matchAll(/"(?:id|tool_use_id|toolCallId)"\s*:\s*"([^"]+)"/gu)].map((m) => m[1])
  const name = ids.map((id) => callNamesById.get(id)).find(Boolean)
  ordered.push({ name: name ?? '(unresolved)', notice: guard[1] })
}

console.log('='.repeat(74))
console.log('GUARD NOTICES, PAIRED WITH THE TOOL THEY SCREENED')
console.log('='.repeat(74))
if (ordered.length === 0) console.log('  (none)')
for (const item of ordered) console.log(`  ${item.name.padEnd(36)} ${item.notice}`)

// ── every content-ingesting call, and whether it produced a notice ───────────
console.log(`\n${'='.repeat(74)}`)
console.log('CONTENT-INGESTING TOOLS: RAN vs. NOTICED')
console.log('='.repeat(74))

const INGEST = /^(web_fetch|web_search|read_page|read_url|search|browse|crawl|mcp__[a-z0-9_-]+__fetch_content)$/u
const ranCounts = new Map()
const noticedCounts = new Map()

const walkCalls = (value) => {
  if (Array.isArray(value)) { value.forEach(walkCalls); return }
  if (!value || typeof value !== 'object') return
  if (typeof value.name === 'string' && INGEST.test(value.name)) {
    ranCounts.set(value.name, (ranCounts.get(value.name) ?? 0) + 1)
  }
  for (const v of Object.values(value)) walkCalls(v)
}
for (const record of records) walkCalls(record)

for (const item of ordered) {
  if (item.name !== '(unresolved)') noticedCounts.set(item.name, (noticedCounts.get(item.name) ?? 0) + 1)
}

for (const [name, count] of [...ranCounts].sort((a, b) => b[1] - a[1])) {
  const noticed = noticedCounts.get(name) ?? 0
  const status = noticed > 0 ? 'OK' : 'GAP'
  console.log(`  [${status.padEnd(3)}] ${name.padEnd(42)} ran ${count}, noticed ${noticed}`)
}

console.log('\nInterpreting a GAP:')
console.log('  - the tool is not listed in settings.guardTools, OR')
console.log('  - its result was shorter than guardMinChars (skipped by design), OR')
console.log('  - the notice could not be paired because the id was not recoverable.')
console.log('  Check the notice text: "below-min-chars" is the by-design skip.')
