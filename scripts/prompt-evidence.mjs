// Determine whether the TypeSafe prompt section actually reached a model request.
//
// The naive check — "does the marker string appear in the session log?" — gives a
// FALSE POSITIVE, because the marker is also a literal in the plugin's own source
// file, so it shows up in the tool arguments of every write/read of lib/index.js.
// This script therefore looks only where a system prompt can legitimately live.
//
// Usage: node scripts/prompt-evidence.mjs [sessionDir]

import { resolveSession, listSessions, readSessionFile, recordsFrom, recordType } from './lib/session-store.mjs'

const MARKER = 'Jev is a decision model'

const arg = process.argv[2]
const target = resolveSession(arg)
if (!target || target.files.length === 0) {
  console.error(`No session found${arg ? ` matching "${arg}"` : ''}.`)
  process.exit(2)
}

console.log(`Session: ${target.dir}\n`)
const records = recordsFrom(target.files)
console.log(`Records: ${records.length}\n`)

// Classify every record: where does the marker appear?
const buckets = {}
for (const record of records) {
  if (!JSON.stringify(record).includes(MARKER)) continue
  const type = recordType(record) || '(untyped)'
  buckets[type] = (buckets[type] ?? 0) + 1
}

console.log('Records containing the marker, by record type:')
for (const [type, count] of Object.entries(buckets).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${count.toString().padStart(4)}  ${type}`)
}
console.log('')

// The decisive question: is the marker being DELIVERED as a system prompt for a
// request, or does it merely appear in the transcript?
//
// Record TYPE is the reliable discriminator, not the JSON path: a `system/message`
// record IS a system prompt the provider received, while `tool/call`,
// `tool/result`, and `assistant/message` records mentioning the marker are just
// the plugin's own source text passing through the conversation.
const DELIVERY_TYPES = new Set(['system/message'])
let delivered = 0
let transcriptOnly = 0

for (const record of records) {
  if (!JSON.stringify(record).includes(MARKER)) continue
  if (DELIVERY_TYPES.has(recordType(record))) delivered += 1
  else transcriptOnly += 1
}

console.log('Delivery classification:')
console.log(`  system/message records carrying the marker : ${delivered}`)
console.log(`  all other records carrying the marker      : ${transcriptOnly}`)
console.log('')

// Print the actual delivered text, so the claim is readable rather than inferred.
for (const record of records) {
  if (!DELIVERY_TYPES.has(recordType(record))) continue
  if (!JSON.stringify(record).includes(MARKER)) continue
  const strings = []
  const walk = (value, path) => {
    if (typeof value === 'string') { if (value.includes(MARKER)) strings.push({ path, text: value }); return }
    if (Array.isArray(value)) { value.forEach((v, i) => walk(v, `${path}[${i}]`)); return }
    if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`)
  }
  walk(record, '$')
  for (const s of strings) {
    console.log(`--- ${recordType(record)} :: ${s.path} ---`)
    console.log(s.text.slice(0, 1800))
    console.log('')
  }
  break
}

if (delivered === 0) {
  console.log('CONCLUSION: no system/message record in this session contains the section text.')
  console.log('Every occurrence is the plugin source file passing through tool traffic.')
} else {
  console.log(`CONCLUSION: the section text WAS delivered in ${delivered} system prompt record(s).`)
}
