// Pattern matching and coverage-gap detection for the guard's tool list.
//
// The first field test exposed the failure this file exists to prevent: the agent
// read a web page through `read_page`, a tool contributed by a different plugin,
// and the guard never saw it. The allowlist was literal, so any tool the
// deployment added later fell outside coverage with no signal at all.
//
// Usage: node test/guard-coverage.mjs

import assert from 'node:assert/strict'
import { DEFAULT_GUARD_TOOLS } from '../lib/config.js'
import { isGuardedTool, matchesToolPattern, uncoveredIngestTools } from '../lib/guard.js'

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

console.log('pattern matching\n')

check('an exact name matches itself', () => {
  assert.equal(matchesToolPattern('web_fetch', 'web_fetch'), true)
})

check('a non-glob pattern does not match a different name', () => {
  assert.equal(matchesToolPattern('web_fetch', 'web_search'), false)
})

check('a glob covers a whole family', () => {
  assert.equal(matchesToolPattern('mcp__fetch__fetch', 'mcp__*__fetch'), true)
  assert.equal(matchesToolPattern('mcp__duckduckgo-search__fetch', 'mcp__*__fetch'), true)
  assert.equal(matchesToolPattern('mcp__a__b__fetch', 'mcp__*__fetch'), true)
})

check('a glob does not over-match', () => {
  assert.equal(matchesToolPattern('mcp__fetch__search', 'mcp__*__fetch'), false)
  assert.equal(matchesToolPattern('read_file', '*fetch*'), false)
})

check('* spans the __ separator, which is what makes MCP families work', () => {
  assert.equal(matchesToolPattern('mcp__x__y__fetch_content', '*fetch_content'), true)
})

check('? matches exactly one character', () => {
  assert.equal(matchesToolPattern('abc1', 'abc?'), true)
  assert.equal(matchesToolPattern('abc12', 'abc?'), false)
})

check('regex metacharacters in a pattern are literal', () => {
  // A tool named with a dot must not have it treated as "any character".
  assert.equal(matchesToolPattern('a.b', 'a.b'), true)
  assert.equal(matchesToolPattern('axb', 'a.b'), false)
})

console.log('\nthe tools that shipped')

check('every default pattern is a non-empty string', () => {
  for (const pattern of DEFAULT_GUARD_TOOLS) {
    assert.ok(typeof pattern === 'string' && pattern.length > 0, `bad pattern: ${JSON.stringify(pattern)}`)
  }
})

check('read_page is covered — the exact tool that slipped through', () => {
  assert.equal(
    isGuardedTool('read_page', DEFAULT_GUARD_TOOLS),
    true,
    'read_page must be guarded: the field test showed it fetching a page unseen',
  )
})

check('the built-in harness tools are covered', () => {
  for (const name of ['web_fetch', 'web_search']) {
    assert.equal(isGuardedTool(name, DEFAULT_GUARD_TOOLS), true, `${name} is not guarded`)
  }
})

check('MCP fetch servers are covered by family, including renamed ones', () => {
  for (const name of [
    'mcp__fetch__fetch',
    'mcp__duckduckgo-search__fetch_content',
    'mcp__some-other-server__fetch_content',
  ]) {
    assert.equal(isGuardedTool(name, DEFAULT_GUARD_TOOLS), true, `${name} is not guarded`)
  }
})

check('local tools are NOT guarded — screening them wastes money', () => {
  for (const name of ['read', 'write', 'edit', 'glob', 'grep', 'pwsh']) {
    assert.equal(isGuardedTool(name, DEFAULT_GUARD_TOOLS), false, `${name} should not be screened`)
  }
})

console.log('\ncoverage-gap audit')

check('a registered fetch tool outside the list is reported', () => {
  const gaps = uncoveredIngestTools(['web_fetch', 'some_new_fetcher'], ['web_fetch'])
  assert.deepEqual(gaps, ['some_new_fetcher'])
})

check('a covered tool is not reported', () => {
  const gaps = uncoveredIngestTools(['read_page', 'web_fetch'], DEFAULT_GUARD_TOOLS)
  assert.deepEqual(gaps, [], `unexpected gaps: ${gaps.join(', ')}`)
})

check('local tools are never reported as gaps', () => {
  const gaps = uncoveredIngestTools(['read', 'edit', 'todo_write'], DEFAULT_GUARD_TOOLS)
  assert.deepEqual(gaps, [])
})

check('the audit is a superset check over a realistic tool set', () => {
  // Mirrors the observed field session: the harness tools plus modsearch plus MCP.
  const registered = [
    'read', 'write', 'edit', 'glob', 'grep', 'pwsh', 'todo_write',
    'web_fetch', 'web_search', 'read_page',
    'mcp__duckduckgo-search__fetch_content', 'mcp__fetch__fetch',
  ]
  const gaps = uncoveredIngestTools(registered, DEFAULT_GUARD_TOOLS)
  assert.deepEqual(gaps, [], `these content tools would go unscreened: ${gaps.join(', ')}`)
})

check('the audit handles a hostile input shape without throwing', () => {
  assert.deepEqual(uncoveredIngestTools(undefined, DEFAULT_GUARD_TOOLS), [])
  assert.deepEqual(uncoveredIngestTools([1, null, 'x'], DEFAULT_GUARD_TOOLS), [])
  assert.equal(isGuardedTool('x', undefined), false)
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
