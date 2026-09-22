// Deep-dive one session's TypeSafe usage: the exact question set, the returned
// probabilities, and which tool result each guard notice was attached to.
//
// The summary counts in audit-session.mjs answer "how many"; this answers "what
// shape", which is what decides whether the plugin's guidance worked.
//
// Usage: node scripts/inspect-typesafe-call.mjs <sessionIdFragment>

import { resolveSession, recordsFrom } from './lib/session-store.mjs'

const fragment = process.argv[2]
if (!fragment) {
  console.error('usage: node scripts/inspect-typesafe-call.mjs <sessionIdFragment>')
  process.exit(2)
}
const target = resolveSession(fragment)
if (!target) {
  console.error(`no session matching "${fragment}"`)
  process.exit(2)
}

const records = recordsFrom(target.files)
console.log(`session: ${target.dir}`)
console.log(`records: ${records.length}\n`)

// ── the call arguments ───────────────────────────────────────────────────────
const SEP = '='.repeat(74)
console.log(SEP)
console.log('THE TYPESAFE_DECIDE CALL')
console.log(SEP)

let callArgs
const findArgs = (value) => {
  if (Array.isArray(value)) { value.forEach(findArgs); return }
  if (!value || typeof value !== 'object') return
  if (value.name === 'typesafe_decide' && value.arguments !== undefined) {
    let args = value.arguments
    if (typeof args === 'string') { try { args = JSON.parse(args) } catch { return } }
    if (args && typeof args === 'object' && args.questions) callArgs = args
  }
  for (const v of Object.values(value)) findArgs(v)
}
for (const record of records) findArgs(record)

if (!callArgs) {
  console.log('The call arguments were not recoverable (streamed chunks only).')
} else {
  const ids = Object.keys(callArgs.questions)
  const types = {}
  for (const q of Object.values(callArgs.questions)) types[q.type] = (types[q.type] ?? 0) + 1
  console.log(`questions: ${ids.length}`)
  console.log(`by type:   ${Object.entries(types).map(([t, n]) => `${t}=${n}`).join(', ')}`)

  // The id naming pattern reveals whether the agent structured the batch per
  // item (cat001, urg001, …) or asked one aggregate question.
  const prefixes = {}
  for (const id of ids) {
    const prefix = id.replace(/\d+$/u, '')
    prefixes[prefix] = (prefixes[prefix] ?? 0) + 1
  }
  console.log(`id prefixes: ${Object.entries(prefixes).map(([p, n]) => `${p || '(none)'}×${n}`).join(', ')}`)
  console.log('\nfirst 6 questions:')
  for (const id of ids.slice(0, 6)) {
    const q = callArgs.questions[id]
    const inst = typeof q.instructions === 'string' ? q.instructions : JSON.stringify(q.instructions)
    console.log(`  ${id} [${q.type}] ${inst.slice(0, 96)}`)
    if (q.criteria && q.type === 'choice') console.log(`      options: ${Object.keys(q.criteria).join(', ')}`)
    if (q.criteria && q.type === 'score') console.log(`      levels: ${q.criteria.length}`)
  }
}

// ── the returned answers ─────────────────────────────────────────────────────
console.log(`\n${SEP}`)
console.log('THE RETURNED ANSWERS (as recorded in the tool result)')
console.log(SEP)

const answers = []
const findAnswers = (value) => {
  if (Array.isArray(value)) { value.forEach(findAnswers); return }
  if (!value || typeof value !== 'object') return
  for (const [k, v] of Object.entries(value)) {
    if (k === 'answers' && v && typeof v === 'object') answers.push(v)
    else findAnswers(v)
  }
}
for (const record of records) findAnswers(record)

if (answers.length === 0) {
  console.log('No structured answers found (the result may be rendered text only).')
} else {
  const last = answers[answers.length - 1]
  console.log(`answer keys: ${Object.keys(last).length}`)
  // Show the distribution of choice answers: a well-calibrated batch should have
  // some low-confidence entries, which is exactly what the user asked for.
  const lowConfidence = []
  for (const [id, a] of Object.entries(last)) {
    if (a && typeof a === 'object' && typeof a.confidence === 'number' && a.confidence < 0.7) {
      lowConfidence.push({ id, confidence: a.confidence, choice: a.choice, probs: a.probabilities })
    }
  }
  console.log(`answers with confidence < 0.7: ${lowConfidence.length}`)
  for (const item of lowConfidence.slice(0, 10)) {
    const dist = item.probs
      ? Object.entries(item.probs).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k}=${v}`).join(', ')
      : ''
    console.log(`  ${item.id}: conf=${item.confidence} choice=${item.choice} [${dist}]`)
  }
}

// ── which tool result each guard notice belongs to ───────────────────────────
console.log(`\n${SEP}`)
console.log('GUARD NOTICES AND THE TOOL THEY SCREENED')
console.log(SEP)

const pairs = []
for (const record of records) {
  const text = JSON.stringify(record)
  if (!text.includes('[TypeSafe guard]')) continue
  const toolMatch = text.match(/"tool(?:Name|_name|name)"\s*:\s*"([^"]+)"/u)
  const noticeMatch = text.match(/\[TypeSafe guard\] ([^"\\]{0,90})/u)
  if (noticeMatch) pairs.push({ tool: toolMatch?.[1] ?? '(unknown)', notice: noticeMatch[1] })
}
if (pairs.length === 0) console.log('  (none)')
for (const pair of pairs) console.log(`  ${pair.tool.padEnd(34)} ${pair.notice}`)

// ── content tools that ran WITHOUT a notice ──────────────────────────────────
console.log(`\n${SEP}`)
console.log('CONTENT TOOLS WITH NO GUARD NOTICE (candidate gaps)')
console.log(SEP)

const INGEST = /^(web_fetch|web_search|read_page|read_url|search|browse|crawl)$|fetch_content/u
const ingest = new Set()
const walkNames = (value) => {
  if (Array.isArray(value)) { value.forEach(walkNames); return }
  if (!value || typeof value !== 'object') return
  if (typeof value.name === 'string' && INGEST.test(value.name)) ingest.add(value.name)
  for (const v of Object.values(value)) walkNames(v)
}
for (const record of records) walkNames(record)

const noticedTools = new Set(pairs.map((p) => p.tool))
for (const tool of ingest) {
  const flagged = [...noticedTools].some((t) => t === tool)
  console.log(`  ${flagged ? '[noticed]  ' : '[NO NOTICE]'} ${tool}`)
}
