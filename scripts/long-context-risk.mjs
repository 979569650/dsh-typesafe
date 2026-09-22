// Separate the two things that can push the TypeSafe section around, and check
// whether compaction can ever remove it.
//
// Risk 1 — DRIFT: other sections render at lower orders and grow, pushing the
//   plugin's guidance later. The memory section (order 50) is the main grower.
// Risk 2 — COMPACTION: when a long conversation is compacted, does the system
//   prompt survive, or can the instruction be summarized away?
//
// These are measured separately because they have different fixes.
//
// Usage: node scripts/long-context-risk.mjs <sessionIdFragment>

import { resolveSession, recordsFrom, systemPromptsCarrying, recordType } from './lib/session-store.mjs'

const MARKERS = ['STOP AND USE IT', 'You have TypeSafe Jev available']

const fragment = process.argv[2]
if (!fragment) {
  console.error('usage: node scripts/long-context-risk.mjs <sessionIdFragment>')
  process.exit(2)
}
const target = resolveSession(fragment)
if (!target) { console.error('session not found'); process.exit(2) }

const records = recordsFrom(target.files)

console.log(`session: ${target.dir}`)
console.log(`records: ${records.length}\n`)

// ── how many prompts, and did any arrive WITHOUT the section? ────────────────
const carrying = new Map()
for (const prompt of systemPromptsCarrying(records, MARKERS)) carrying.set(prompt.seq, prompt)

let seq = 0
let systemPrompts = 0
const withoutSection = []
for (const record of records) {
  seq += 1
  if (recordType(record) !== 'system/message') continue
  systemPrompts += 1
  if (carrying.has(seq)) continue
  // Record its size and first heading so an unexpected shape is identifiable.
  let body
  const walk = (v) => {
    if (body !== undefined) return
    if (typeof v === 'string' && v.length > 100) { body = v; return }
    if (Array.isArray(v)) { v.forEach(walk); return }
    if (v && typeof v === 'object') Object.values(v).forEach(walk)
  }
  walk(record)
  withoutSection.push({ seq, chars: body?.length ?? 0, head: body?.slice(0, 90) ?? '(no long string)' })
}

console.log('SYSTEM PROMPT COVERAGE')
console.log(`  recorded system prompts : ${systemPrompts}`)
console.log(`  carrying the section    : ${carrying.size}`)
console.log(`  NOT carrying it         : ${withoutSection.length}`)
for (const item of withoutSection) {
  console.log(`    seq ${item.seq}: ${item.chars} chars — ${JSON.stringify(item.head)}`)
}
console.log('')

// ── compaction: does it appear at all, and does it touch system prompts? ────
const compactionTypes = new Set()
for (const record of records) {
  const type = recordType(record)
  if (/compact|summar|prune|truncat/i.test(type)) compactionTypes.add(type)
}
console.log('COMPACTION ACTIVITY')
if (compactionTypes.size === 0) {
  console.log('  none in this session — the conversation reached its current size without one.')
  console.log('  So this session cannot answer whether compaction preserves the section;')
  console.log('  that needs a session long enough to trigger it.')
} else {
  for (const type of compactionTypes) console.log(`  ${type}`)
}
console.log('')

// ── the structural question: is the prompt RE-ASSEMBLED per request? ────────
// A system prompt whose size tracks the conversation would mean the instruction
// is being rewritten; a constant size means it is regenerated from the same
// sections each turn, which is what makes a fixed offset meaningful.
const promptSizes = [...carrying.values()].map((p) => ({ seq: p.seq, size: p.text.length }))

console.log('PROMPT STABILITY (does the prompt grow with the conversation?)')
if (promptSizes.length === 0) {
  console.log('  no prompts with the section')
} else {
  for (const p of promptSizes) console.log(`  seq ${String(p.seq).padStart(5)}: ${p.size} chars`)
  const sizes = promptSizes.map((p) => p.size)
  const spread = Math.max(...sizes) - Math.min(...sizes)
  console.log(`\n  size spread across the session: ${spread} chars`)
  console.log('  A small spread means the prompt is RE-ASSEMBLED from the same sections')
  console.log('  each request rather than accumulated — so the instruction keeps its place')
  console.log('  no matter how long the conversation becomes.')
}
