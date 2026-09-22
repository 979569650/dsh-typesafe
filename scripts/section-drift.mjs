// What sits BEFORE the TypeSafe section, and does it grow?
//
// The section's position is not fixed: other sections render at lower orders and
// push it later. The memory section (order 50) is the main suspect, since it
// renders every pinned and recent memory and therefore grows as memories
// accumulate. This measures that drift so the long-context risk can be stated as
// a number rather than a worry.
//
// Usage: node scripts/section-drift.mjs <sessionIdFragment>

import { resolveSession, recordsFrom, systemPromptsCarrying } from './lib/session-store.mjs'

const MARKERS = ['STOP AND USE IT', 'You have TypeSafe Jev available']
const MEMORY_MARKER = 'Memories you previously stored'

const fragment = process.argv[2]
if (!fragment) {
  console.error('usage: node scripts/section-drift.mjs <sessionIdFragment>')
  process.exit(2)
}
const target = resolveSession(fragment)
if (!target) { console.error('session not found'); process.exit(2) }

const records = recordsFrom(target.files)
console.log(`session: ${target.dir}\n`)

/** Every recorded system prompt carrying either revision of the section. */
const prompts = systemPromptsCarrying(records, MARKERS).map((prompt) => ({
  seq: prompt.seq,
  length: prompt.text.length,
  offset: prompt.offset,
  version: prompt.marker === MARKERS[0] ? 'new' : 'OLD',
  memoryAt: prompt.text.indexOf(MEMORY_MARKER),
  before: prompt.offset,
}))

if (prompts.length === 0) {
  console.log('No recorded system prompt carried the section.')
  process.exit(1)
}

console.log('seq   version  prompt  sectionAt  share   memoryAt  beforeSection')
for (const p of prompts) {
  console.log(
    `${String(p.seq).padStart(4)}  ${p.version.padEnd(7)}  ${String(p.length).padStart(6)}  `
    + `${String(p.offset).padStart(9)}  ${(p.offset / p.length * 100).toFixed(1).padStart(5)}%  `
    + `${String(p.memoryAt < 0 ? '-' : p.memoryAt).padStart(8)}  ${String(p.before).padStart(13)}`,
  )
}

console.log('')
if (prompts.length > 1) {
  const first = prompts[0]
  const last = prompts[prompts.length - 1]
  console.log(`drift across this session: ${last.before - first.before >= 0 ? '+' : ''}${last.before - first.before} chars before the section`)
  console.log(`section share: ${(first.offset / first.length * 100).toFixed(1)}% -> ${(last.offset / last.length * 100).toFixed(1)}%`)
}

// The memory section is the dominant grower ahead of the plugin's section.
const withMemory = prompts.filter((p) => p.memoryAt >= 0)
if (withMemory.length > 0) {
  console.log('\nMemory section is present and renders BEFORE the TypeSafe section')
  console.log('(memory promptOrder 50 < typesafe promptOrder 700), so every added memory')
  console.log('pushes the plugin guidance later in the prompt.')
  const memoryChars = withMemory[withMemory.length - 1].memoryAt >= 0
    ? withMemory[withMemory.length - 1].offset - withMemory[withMemory.length - 1].memoryAt
    : 0
  console.log(`  memory section size in the latest prompt: ~${memoryChars} chars`)
} else {
  console.log('\nNo memory section detected in these prompts.')
}
