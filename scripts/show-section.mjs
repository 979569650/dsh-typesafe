// Print the exact TypeSafe prompt section as delivered, with its position among
// the other sections.
//
// This is the "show me the evidence" script: it reads the session store, finds
// the newest system/message record, and prints the region around the plugin's
// section along with the section boundaries that surround it — so the claim
// "the agent is told when to use these tools" is checkable by reading, not by
// trusting the plugin's own tests.
//
// Usage: node scripts/show-section.mjs [sessionDir]

import { resolveSession, recordsFrom, systemPromptsCarrying } from './lib/session-store.mjs'

const MARKER = 'Jev is a decision model'

const target = resolveSession(process.argv[2])
if (!target) {
  console.error('No session found.')
  process.exit(1)
}

const records = recordsFrom(target.files)

// The newest system/message record carrying the section. Reading it through the
// shared store reader matters: the store is multi-frame zstd, and a single
// decode returns only the first frame.
const carrying = systemPromptsCarrying(records, [MARKER])
const hit = carrying[carrying.length - 1]

if (!hit) {
  console.error('No system/message record carrying the section text was found.')
  console.error('The section is registered but has not been delivered in a recorded request.')
  process.exit(1)
}

console.log(`Session:  ${target.dir}`)
console.log(`Prompt length: ${hit.text.length} chars`)
console.log(`System prompt records carrying the section: ${carrying.length}\n`)

// Locate the section and show its neighbourhood: which section precedes it and
// which follows. That is what proves it is a real section in the assembled
// prompt rather than text pasted somewhere incidental.
const at = hit.offset
const SECTION_LEN = 900
const from = Math.max(0, at - 700)
const to = Math.min(hit.text.length, at + SECTION_LEN)

console.log('='.repeat(72))
console.log(`SECTION TEXT (offset ${at} of ${hit.text.length})`)
console.log('='.repeat(72))
console.log(hit.text.slice(from, to))
console.log('='.repeat(72))

// Report the surrounding section headers, read as the blank-line-separated
// blocks the prompt is assembled from.
const blocks = hit.text.split('\n\n')
const markerBlock = blocks.findIndex((b) => b.includes(MARKER))
console.log(`\nIt sits in block ${markerBlock + 1} of ${blocks.length}.`)
for (const offset of [-1, 0, 1]) {
  const block = blocks[markerBlock + offset]
  if (block === undefined) continue
  const label = offset === 0 ? 'THIS SECTION' : offset < 0 ? 'PRECEDING' : 'FOLLOWING'
  const firstLine = block.split('\n')[0].slice(0, 100)
  console.log(`  ${label.padEnd(11)} block ${markerBlock + offset + 1}: ${firstLine}${block.length > 100 ? '…' : ''}`)
}
