/**
 * Offline checks for the pure layers: request construction, validation, cost
 * accounting, and guard text handling. No network, no API key, no harness.
 *
 * Run: node test/smoke.mjs
 */

import assert from 'node:assert/strict'
import { buildRequestBody, costOf, confidenceOf, JevError, JEV_ERROR_CODES } from '../lib/jev.js'
import { renderVerdict, textOfContent } from '../lib/guard.js'
import { round } from '../lib/config.js'

let passed = 0
let failed = 0

/** Run one named check, reporting rather than aborting so all failures are visible at once. */
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

/** Assert that `fn` throws a JevError with the expected code. */
function throwsCode(fn, code) {
  try {
    fn()
  } catch (error) {
    assert.ok(error instanceof JevError, `expected JevError, got ${error?.name}`)
    assert.equal(error.code, code)
    return
  }
  assert.fail(`expected a throw with code ${code}`)
}

console.log('buildRequestBody')

check('builds a minimal noul request', () => {
  const body = JSON.parse(buildRequestBody({
    state: 'Help, my payouts have been failing for 3 days.',
    model: 'jev-latest',
    questions: { urgent: { type: 'noul', instructions: 'Does this convey urgency?' } },
  }))
  assert.equal(body.model, 'jev-latest')
  assert.equal(body.questions.urgent.type, 'noul')
  assert.equal(body.state, 'Help, my payouts have been failing for 3 days.')
})

check('accepts a structured object state', () => {
  const body = JSON.parse(buildRequestBody({
    state: { messages: [{ role: 'user', text: 'hello' }] },
    model: 'jev-latest',
    questions: { ok: { type: 'noul', instructions: 'Is this fine?' } },
  }))
  assert.deepEqual(body.state, { messages: [{ role: 'user', text: 'hello' }] })
})

check('passes choice options through as criteria', () => {
  const body = JSON.parse(buildRequestBody({
    state: 'x',
    model: 'm',
    questions: {
      dept: {
        type: 'choice',
        instructions: 'Which team?',
        criteria: { billing: 'Payments', technical: 'Bugs' },
      },
    },
  }))
  assert.deepEqual(body.questions.dept.criteria, { billing: 'Payments', technical: 'Bugs' })
})

check('rejects a blank state', () => {
  throwsCode(() => buildRequestBody({
    state: '   ', model: 'm', questions: { a: { type: 'noul', instructions: 'q' } },
  }), JEV_ERROR_CODES.BAD_REQUEST)
})

check('rejects an empty questions map', () => {
  throwsCode(() => buildRequestBody({ state: 'x', model: 'm', questions: {} }), JEV_ERROR_CODES.BAD_REQUEST)
})

check('rejects an unknown question type', () => {
  throwsCode(() => buildRequestBody({
    state: 'x', model: 'm', questions: { a: { type: 'yesno', instructions: 'q' } },
  }), JEV_ERROR_CODES.BAD_REQUEST)
})

check('rejects a choice with no options', () => {
  throwsCode(() => buildRequestBody({
    state: 'x', model: 'm', questions: { a: { type: 'choice', instructions: 'q', criteria: {} } },
  }), JEV_ERROR_CODES.BAD_REQUEST)
})

check('rejects a score with a single level', () => {
  throwsCode(() => buildRequestBody({
    state: 'x', model: 'm', questions: { a: { type: 'score', instructions: 'q', criteria: ['only'] } },
  }), JEV_ERROR_CODES.BAD_REQUEST)
})

check('rejects a score with more than 10 levels', () => {
  throwsCode(() => buildRequestBody({
    state: 'x', model: 'm', questions: { a: { type: 'score', instructions: 'q', criteria: Array.from({ length: 11 }, (_, i) => `L${i}`) } },
  }), JEV_ERROR_CODES.BAD_REQUEST)
})

check('rejects a choice with more than 255 options', () => {
  const criteria = {}
  for (let i = 0; i < 256; i += 1) criteria[`o${i}`] = 'd'
  throwsCode(() => buildRequestBody({
    state: 'x', model: 'm', questions: { a: { type: 'choice', instructions: 'q', criteria } },
  }), JEV_ERROR_CODES.BAD_REQUEST)
})

check('rejects a missing instructions field', () => {
  throwsCode(() => buildRequestBody({
    state: 'x', model: 'm', questions: { a: { type: 'noul' } },
  }), JEV_ERROR_CODES.BAD_REQUEST)
})

console.log('\ncost + confidence')

check('bills input tokens only', () => {
  const cost = costOf({ input_tokens: 1_000_000, output_tokens: 999_999 }, 0.042)
  assert.equal(cost.inputTokens, 1_000_000)
  assert.equal(cost.outputTokens, 999_999)
  assert.equal(round(cost.costUsd, 6), 0.042)
})

check('a 392-token call costs about $0.0000165', () => {
  const cost = costOf({ input_tokens: 392, output_tokens: 65 }, 0.042)
  assert.equal(round(cost.costUsd, 7), 0.0000165)
})

check('tolerates a missing usage object', () => {
  const cost = costOf(undefined, 0.042)
  assert.deepEqual(cost, { inputTokens: 0, outputTokens: 0, costUsd: 0 })
})

check('reads confidence off choice/score answers', () => {
  assert.equal(confidenceOf({ type: 'choice', confidence: 0.81 }), 0.81)
  assert.equal(confidenceOf({ type: 'score', confidence: 1 }), 1)
})

check('reports no confidence for a noul answer', () => {
  assert.equal(confidenceOf({ type: 'noul', noul: 0.95 }), undefined)
})

console.log('\nguard helpers')

check('flattens only text content blocks', () => {
  const text = textOfContent([
    { type: 'text', text: 'first' },
    { type: 'image', data: 'xxx' },
    { type: 'text', text: 'second' },
  ])
  assert.equal(text, 'first\nsecond')
})

check('returns empty text for a non-array', () => {
  assert.equal(textOfContent(undefined), '')
  assert.equal(textOfContent('a string'), '')
})

check('renders a blocked verdict with a do-not-follow instruction', () => {
  const rendered = renderVerdict({
    screened: true, verdict: 'blocked', injection: 0.97, harm: 3, harmLabel: 'Severe', costUsd: 0.00002, toolName: 'web_fetch',
  })
  assert.match(rendered, /LIKELY PROMPT INJECTION/)
  assert.match(rendered, /97%/)
})

check('renders a clear verdict, not silence', () => {
  const rendered = renderVerdict({
    screened: true, verdict: 'clear', injection: 0.02, harm: 0, harmLabel: 'None', costUsd: 0.00002, toolName: 'web_fetch',
  })
  assert.match(rendered, /Screened clear/)
})

check('marks an unscreened result as untrusted', () => {
  const rendered = renderVerdict({
    screened: false, verdict: 'clear', injection: null, harm: null, harmLabel: null, costUsd: 0, toolName: 'web_fetch', reason: 'TYPESAFE_NO_API_KEY',
  })
  assert.match(rendered, /Not screened/)
  assert.match(rendered, /UNSCREENED/)
  assert.match(rendered, /TYPESAFE_NO_API_KEY/)
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
