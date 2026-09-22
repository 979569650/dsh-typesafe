// Prove, with the real session service, that compaction cannot remove or rewrite
// the TypeSafe prompt section.
//
// The concern this answers: a long conversation gets compacted, and the
// instruction that makes the agent use the plugin either (a) gets summarized away
// or (b) drifts so far that it stops firing. Reading the compaction source
// suggests both are impossible, but "the source suggests" is not evidence.
//
// This test drives the REAL `@deepseek-ai/dsh-session` surface machinery:
//   1. Build a session whose surface node 0 is a system prompt containing the
//      plugin's section.
//   2. Append a long conversation.
//   3. Apply the exact `replace` op compaction uses, over the conversation span.
//   4. Assert the system prompt is intact, still node 0, and still carrying the
//      section at the same offset.
//   5. Attempt the malicious variant — a replace that covers node 0 — and assert
//      the session service REFUSES it.
//
// Usage: node test/compaction-survives.mjs

import assert from 'node:assert/strict'
import { Session, deriveEventMessage } from '@deepseek-ai/dsh-session'
import { DEFAULT_PROMPT_ORDER } from '../lib/config.js'

let passed = 0
let failed = 0

function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok   ${name}`)
  } catch (error) {
    failed += 1
    console.log(`  FAIL ${name}\n       ${error.message}`)
  }
}

/** The section text, reproduced from lib/index.js (the marker is what we track). */
const SECTION_MARKER = 'STOP AND USE IT'
const SYSTEM_PROMPT = [
  'You are an AI agent powered by DeepSeek Harness.',
  '',
  'Some earlier instruction.',
  '',
  'TypeSafe Jev is a decision model you can call.',
  SECTION_MARKER,
  'when you catch yourself about to do any of these by hand:',
  '- Writing keyword rules, regex, or heuristics to classify text.',
  '',
  'Trailing harness text.',
].join('\n')

/**
 * A detached session whose surface node 0 is the system prompt.
 *
 * The payload shape matters and was wrong on the first attempt: `system/message`
 * carries `{ message }` (that is what `deriveEventMessage` reads), while
 * `user/message` carries the message itself. Getting this wrong throws inside
 * the harness's own projection, which is how it was caught.
 */
function makeSession() {
  const session = Session.create('compaction-test')
  session.append(
    'system/message',
    { message: { role: 'system', content: [{ type: 'text', text: SYSTEM_PROMPT }] } },
    { surfaceOp: 'append' },
  )
  return session
}

/** Append conversation messages, returning their seqs. */
function appendConversation(session, count) {
  const seqs = []
  for (let i = 0; i < count; i += 1) {
    session.append(
      'user/message',
      { role: 'user', content: [{ type: 'text', text: `message ${i} ${'x'.repeat(50)}` }] },
      { surfaceOp: 'append' },
    )
    seqs.push(session.log[session.log.length - 1].seq)
  }
  return seqs
}

/**
 * The serialized system prompt currently visible to the model.
 *
 * `surface.nodes` is a list of SEQS, not node objects, so the event is looked up
 * by seq and projected with `deriveEventMessage` — the same function the harness
 * uses to turn a surface event into the message a provider receives. Reading the
 * raw event instead would test a representation the model never sees.
 */
function surfaceSystemPrompt(session) {
  const seqs = session.surface.nodes
  assert.ok(seqs.length > 0, 'surface has no nodes')
  const firstSeq = seqs[0]
  const event = session.log.find((candidate) => candidate.seq === firstSeq)
  assert.ok(event, `no event at the first surface seq ${firstSeq}`)
  assert.equal(event.type, 'system/message', `node 0 is ${event.type}, not the system prompt`)
  return JSON.stringify(deriveEventMessage(event))
}

/** Whether the checkpoint produced by compaction is on the surface. */
function surfaceHoldsCheckpoint(session) {
  for (const seq of session.surface.nodes) {
    const event = session.log.find((candidate) => candidate.seq === seq)
    if (event && JSON.stringify(deriveEventMessage(event)).includes('compacted-summary')) return true
  }
  return false
}

console.log('compaction cannot remove the plugin section\n')

const session = makeSession()
const conversationSeqs = appendConversation(session, 40)

check('the system prompt is surface node 0 and carries the section', () => {
  const text = surfaceSystemPrompt(session)
  assert.ok(text.includes(SECTION_MARKER), 'surface node 0 does not contain the section')
})

const offsetBefore = surfaceSystemPrompt(session).indexOf(SECTION_MARKER)

check('compacting the conversation leaves the system prompt byte-identical', () => {
  const before = surfaceSystemPrompt(session)
  const startSeq = conversationSeqs[0]
  const endSeq = conversationSeqs[conversationSeqs.length - 1]

  // Exactly what compaction appends: a checkpoint user/message replacing the span.
  session.append(
    'user/message',
    {
      role: 'user',
      content: [{ type: 'text', text: '<compacted-summary>\ncondensed history\n</compacted-summary>' }],
    },
    {
      surfaceOp: { op: 'replace', startSeq, endSeq },
      sourceEventSeqs: [...conversationSeqs],
    },
  )

  const after = surfaceSystemPrompt(session)
  assert.equal(after, before, 'the system prompt changed across compaction')
})

check('the section keeps its exact offset after compaction', () => {
  const offsetAfter = surfaceSystemPrompt(session).indexOf(SECTION_MARKER)
  assert.equal(offsetAfter, offsetBefore, `offset moved ${offsetBefore} -> ${offsetAfter}`)
})

check('compaction actually shrank the surface (the replace was real)', () => {
  const surviving = session.surface.nodes.length
  // 1 system prompt + 1 checkpoint. Had the replace not applied, all 40
  // conversation messages would still be on the surface.
  assert.ok(surviving <= 3, `surface still holds ${surviving} nodes; the replace did not take effect`)
  assert.ok(surfaceHoldsCheckpoint(session), 'no checkpoint is present on the surface')
})

check('the checkpoint landed after the system prompt, not over it', () => {
  const seqs = session.surface.nodes
  const first = session.log.find((candidate) => candidate.seq === seqs[0])
  assert.equal(first.type, 'system/message', 'the first surface node is no longer the system prompt')
  assert.ok(
    JSON.stringify(deriveEventMessage(first)).includes(SECTION_MARKER),
    'the first surface node no longer carries the section',
  )
})

console.log('\nmalicious variant: a replace that covers node 0\n')

check('the session service REFUSES a replace covering the system prompt', () => {
  const fresh = makeSession()
  const seqs = appendConversation(fresh, 5)
  const systemSeq = fresh.surface.nodes[0]

  assert.throws(
    () => {
      fresh.append(
        'user/message',
        { role: 'user', content: [{ type: 'text', text: 'I am now the system prompt' }] },
        {
          // This is the attack: swallow node 0 along with the conversation.
          surfaceOp: { op: 'replace', startSeq: systemSeq, endSeq: seqs[seqs.length - 1] },
          sourceEventSeqs: [systemSeq, ...seqs],
        },
      )
    },
    (error) => {
      // The guard is explicit about why, so assert on the reason rather than
      // merely that something threw.
      assert.match(
        String(error.message),
        /node 0|system prompt/iu,
        `refused, but not for the system-prompt reason: ${error.message}`,
      )
      return true
    },
  )
})

check('the refused write left the system prompt untouched', () => {
  const fresh = makeSession()
  const seqs = appendConversation(fresh, 5)
  const systemSeq = fresh.surface.nodes[0]
  try {
    fresh.append(
      'user/message',
      { role: 'user', content: [{ type: 'text', text: 'I am now the system prompt' }] },
      {
        surfaceOp: { op: 'replace', startSeq: systemSeq, endSeq: seqs[seqs.length - 1] },
        sourceEventSeqs: [systemSeq, ...seqs],
      },
    )
  } catch {
    // Expected; the assertion below is that the surface is unchanged.
  }
  assert.ok(surfaceSystemPrompt(fresh).includes(SECTION_MARKER), 'the section was lost despite the refusal')
})

console.log('\nwhat the harness guarantees, restated as the invariant\n')

check('node 0 can only ever be rewritten by another system/message over exactly it', () => {
  // Positive control: a legitimate system-prompt refresh IS allowed when it
  // targets node 0 alone, which is how the harness re-assembles an updated
  // prompt (e.g. after the plugin text changed) without a restart.
  const fresh = makeSession()
  const systemSeq = fresh.surface.nodes[0]
  const updated = `${SYSTEM_PROMPT}\n\nAnd one more line.`
  fresh.append(
    'system/message',
    { message: { role: 'system', content: [{ type: 'text', text: updated }] } },
    { surfaceOp: { op: 'replace', startSeq: systemSeq, endSeq: systemSeq }, sourceEventSeqs: [systemSeq] },
  )
  const text = surfaceSystemPrompt(fresh)
  assert.ok(text.includes('And one more line.'), 'a legitimate system-prompt refresh was rejected')
  assert.ok(text.includes(SECTION_MARKER), 'the refresh dropped the section')
})

console.log(`\n${passed} passed, ${failed} failed`)
console.log(`\nplugin section promptOrder: ${DEFAULT_PROMPT_ORDER} (behavioural band)`)
process.exit(failed === 0 ? 0 : 1)
