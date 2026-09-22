// Measure how the system prompt behaves as a session grows.
//
// The concern: if the prompt section sits at a fixed offset inside a system
// prompt that stays ~18k while the CONVERSATION grows to hundreds of thousands of
// characters, does the instruction keep working? Answering that needs to separate
// two things that are easy to conflate — the system prompt (re-assembled per
// request, roughly constant size) and the conversation (grows without bound).
//
// This script reports both curves from real session logs, plus whether compaction
// ever rewrites or drops the section.
//
// Usage: node scripts/context-growth.mjs <sessionIdFragment> [moreIds...]

import { resolveSession, recordsFrom, systemPromptsCarrying, recordType } from './lib/session-store.mjs'

const MARKERS = ['STOP AND USE IT', 'You have TypeSafe Jev available']

/** The running conversation size at each record, to pair against prompt timing. */
function conversationCurve(records) {
  let chars = 0
  const out = []
  for (const record of records) {
    const type = recordType(record)
    const size = JSON.stringify(record).length
    if (type === 'user/message' || type === 'assistant/message' || type === 'tool/result') chars += size
    out.push({ type, chars })
  }
  return out
}

for (const fragment of process.argv.slice(2)) {
  const target = resolveSession(fragment)
  if (!target) { console.log(`\n[${fragment}] not found`); continue }

  const records = recordsFrom(target.files)

  console.log('='.repeat(74))
  console.log(`SESSION ${fragment}`)
  console.log('='.repeat(74))
  console.log(`records: ${records.length}`)

  // A session records a NEW system/message each time the prompt is re-assembled,
  // so the sequence shows whether the section text or its position ever drifted.
  const prompts = systemPromptsCarrying(records, MARKERS).map((prompt) => ({
    seq: prompt.seq,
    length: prompt.text.length,
    version: prompt.marker === MARKERS[0] ? 'new' : 'OLD',
    offset: prompt.offset,
    share: prompt.offset / prompt.text.length,
  }))

  console.log(`\nsystem prompts recorded: ${prompts.length}`)
  if (prompts.length === 0) {
    console.log('  (none carried the section)')
  } else {
    console.log('  seq   version   promptChars   sectionOffset   share')
    for (const prompt of prompts) {
      console.log(
        `  ${String(prompt.seq).padStart(4)}   ${prompt.version.padEnd(7)}   ${String(prompt.length).padStart(9)}   `
        + `${String(prompt.offset).padStart(11)}   ${(prompt.share * 100).toFixed(1)}%`,
      )
    }
    const versions = new Set(prompts.map((p) => p.version))
    if (versions.size > 1) {
      console.log('\n  NOTE: this session saw BOTH prompt revisions — the plugin was changed mid-session,')
      console.log('  and the harness re-assembled the prompt on the next request without a restart.')
    }
    const shares = prompts.map((p) => p.share)
    console.log(`\n  offset share: min ${(Math.min(...shares) * 100).toFixed(1)}%  max ${(Math.max(...shares) * 100).toFixed(1)}%`)
  }

  const curve = conversationCurve(records)
  const finalChars = curve.length > 0 ? curve[curve.length - 1].chars : 0
  console.log(`\nconversation characters accumulated: ${finalChars}`)
  const ratio = prompts.length > 0 && finalChars > 0
    ? (finalChars / prompts[prompts.length - 1].length)
    : 0
  console.log(`conversation / system-prompt ratio: ${ratio.toFixed(2)}x`)
  console.log('')
}
