// Dump the full argument payload of every TypeSafe call in a session, untruncated.
//
// audit-session.mjs summarizes the shape; this prints the actual questions,
// criteria, and any literal state, which is what decides whether a call was
// designed well or merely made.
//
// Usage: node scripts/dump-call.mjs <sessionIdFragment>

import { resolveSession, recordsFrom } from './lib/session-store.mjs'

const fragment = process.argv[2]
if (!fragment) {
  console.error('usage: node scripts/dump-call.mjs <sessionIdFragment>')
  process.exit(2)
}
const target = resolveSession(fragment)
if (!target) { console.error('session not found'); process.exit(2) }

const records = recordsFrom(target.files)

// Collect the largest version of each typesafe call (streamed chunks accumulate).
const calls = new Map()
const walk = (value) => {
  if (Array.isArray(value)) { value.forEach(walk); return }
  if (!value || typeof value !== 'object') return
  if (typeof value.name === 'string' && value.name.startsWith('typesafe_')) {
    let args = value.arguments
    if (typeof args === 'string') { try { args = JSON.parse(args) } catch { return } }
    if (args && typeof args === 'object') {
      const key = value.name
      const size = JSON.stringify(args).length
      const prev = calls.get(key)
      if (!prev || size > prev.size) calls.set(key, { name: value.name, args, size })
    }
  }
  for (const v of Object.values(value)) walk(v)
}
for (const record of records) walk(record)

console.log(`session: ${target.dir}`)
console.log(`distinct typesafe calls: ${calls.size}\n`)

for (const { name, args, size } of calls.values()) {
  console.log('='.repeat(74))
  console.log(`${name}   (${size} bytes of arguments)`)
  console.log('='.repeat(74))

  if (args.state !== undefined) {
    const state = typeof args.state === 'string' ? args.state : JSON.stringify(args.state, null, 2)
    console.log(`\n--- state (${state.length} chars) ---`)
    console.log(state.slice(0, 2500))
    if (state.length > 2500) console.log(`... [${state.length - 2500} more chars]`)
  }

  if (args.questions) {
    const ids = Object.keys(args.questions)
    console.log(`\n--- questions (${ids.length}) ---`)
    // Print the first entry in full, then every other entry's criteria only if it
    // differs (a batch usually shares one criteria set).
    const first = args.questions[ids[0]]
    console.log(`\n${ids[0]} (full):`)
    console.log(JSON.stringify(first, null, 2))

    const signatures = new Map()
    for (const id of ids) {
      const signature = JSON.stringify(args.questions[id].criteria ?? null)
      if (!signatures.has(signature)) signatures.set(signature, [])
      signatures.get(signature).push(id)
    }
    console.log(`\ndistinct criteria sets: ${signatures.size}`)
    let index = 0
    for (const [signature, members] of signatures) {
      index += 1
      if (index === 1 && members.includes(ids[0])) {
        console.log(`  set 1: shared by ${members.length} question(s) (shown above)`)
        continue
      }
      console.log(`  set ${index}: shared by ${members.length} question(s) — ${members.slice(0, 4).join(', ')}${members.length > 4 ? ', …' : ''}`)
      console.log(`    ${signature.slice(0, 300)}`)
    }

    // Which instruction text is used: one shared instruction or per-item?
    const instructions = new Set(ids.map((id) => JSON.stringify(args.questions[id].instructions)))
    console.log(`\ndistinct instruction strings: ${instructions.size}`)
    for (const instruction of [...instructions].slice(0, 3)) {
      console.log(`  ${instruction.slice(0, 200)}`)
    }
  }

  for (const key of Object.keys(args)) {
    if (['state', 'questions'].includes(key)) continue
    console.log(`\n--- ${key} ---`)
    console.log(JSON.stringify(args[key], null, 2).slice(0, 800))
  }
}
