/**
 * Localization checks for the Settings card.
 *
 * The bundle cannot be imported in Node (it is a browser `__ModuleLoader__`
 * bundle), so the dictionaries are extracted from its source text. That is
 * enough to catch the failure that actually matters: a key present in one
 * language and missing in another renders as the raw key name, which looks to a
 * user like a broken build rather than a missing translation.
 *
 * Run: node test/locale.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE = readFileSync(join(HERE, '..', 'lib', 'client.js'), 'utf8')

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

/**
 * Parse the `DICTS` object literal out of the bundle source.
 *
 * A real parser would need to import the bundle; the object is a flat
 * `locale: { key: 'value' }` literal, so a brace-balanced scan plus a
 * per-language string-literal read is both sufficient and dependency-free.
 * @returns {Record<string, Record<string,string>>} locale id to its dictionary.
 */
function extractDicts() {
  const start = SOURCE.indexOf('const DICTS = {')
  assert.ok(start !== -1, 'DICTS object not found in lib/client.js')
  let depth = 0
  let end = -1
  for (let i = SOURCE.indexOf('{', start); i < SOURCE.length; i += 1) {
    const ch = SOURCE[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) { end = i; break }
    }
  }
  assert.ok(end !== -1, 'DICTS object is not brace-balanced')

  const body = SOURCE.slice(start, end + 1)
  const dicts = {}
  // Each language block starts at `      zh: {` / `      en: {` inside DICTS.
  // The indent width is not fixed here: match any run of spaces so the check
  // survives reindentation instead of silently extracting nothing.
  const blockRe = /^[ \t]+([A-Za-z][A-Za-z0-9-]*):\s*\{[ \t]*$/gmu
  const starts = [...body.matchAll(blockRe)]
  for (let index = 0; index < starts.length; index += 1) {
    const language = starts[index][1]
    const from = starts[index].index
    const to = index + 1 < starts.length ? starts[index + 1].index : body.length
    const block = body.slice(from, to)
    const entries = {}
    // `key: 'value'` and `key: "value"`, allowing escaped quotes inside.
    const entryRe = /^\s+([A-Za-z][A-Za-z0-9]*):\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"),?\s*$/gmu
    for (const match of block.matchAll(entryRe)) {
      entries[match[1]] = match[2] ?? match[3]
    }
    dicts[language] = entries
  }
  return dicts
}

const dicts = extractDicts()
const languages = Object.keys(dicts)

console.log('dictionaries\n')

check('both shipped languages parse', () => {
  assert.ok(languages.includes('zh'), `zh missing; found ${languages.join(', ')}`)
  assert.ok(languages.includes('en'), `en missing; found ${languages.join(', ')}`)
})

check('every language has entries', () => {
  for (const language of languages) {
    assert.ok(Object.keys(dicts[language]).length > 20, `${language} has only ${Object.keys(dicts[language]).length} entries`)
  }
})

check('zh and en declare exactly the same keys', () => {
  const zh = new Set(Object.keys(dicts.zh))
  const en = new Set(Object.keys(dicts.en))
  const missingInZh = [...en].filter((k) => !zh.has(k))
  const missingInEn = [...zh].filter((k) => !en.has(k))
  assert.deepEqual(missingInEn, [], `keys present in zh but missing in en: ${missingInEn.join(', ')}`)
  assert.deepEqual(missingInZh, [], `keys present in en but missing in zh: ${missingInZh.join(', ')}`)
})

check('no translation is blank', () => {
  for (const language of languages) {
    for (const [key, value] of Object.entries(dicts[language])) {
      assert.ok(typeof value === 'string' && value.trim().length > 0, `${language}.${key} is blank`)
    }
  }
})

console.log('\nusage')

check('every key referenced through t() exists in the dictionaries', () => {
  const referenced = new Set()
  // `t('key')` and `t(cond ? 'a' : 'b')` both appear in the card.
  for (const match of SOURCE.matchAll(/\bt\(\s*'([A-Za-z][A-Za-z0-9]*)'/gu)) referenced.add(match[1])
  for (const match of SOURCE.matchAll(/\bt\(\s*[^)]*?\?\s*'([A-Za-z][A-Za-z0-9]*)'\s*:\s*'([A-Za-z][A-Za-z0-9]*)'/gu)) {
    referenced.add(match[1])
    referenced.add(match[2])
  }
  const known = new Set(Object.keys(dicts.en))
  const unknown = [...referenced].filter((key) => !known.has(key))
  assert.deepEqual(unknown, [], `t() references keys with no dictionary entry: ${unknown.join(', ')}`)
})

check('every field label/hint key resolves', () => {
  const referenced = new Set()
  for (const match of SOURCE.matchAll(/(?:labelKey|hintKey|titleKey):\s*'([A-Za-z][A-Za-z0-9]*)'/gu)) referenced.add(match[1])
  const known = new Set(Object.keys(dicts.en))
  const unknown = [...referenced].filter((key) => !known.has(key))
  assert.deepEqual(unknown, [], `field declarations reference missing keys: ${unknown.join(', ')}`)
  assert.ok(referenced.size >= 20, `only ${referenced.size} field keys found; the scan may be missing declarations`)
})

check('every dictionary entry is actually reachable', () => {
  // An entry nothing reads is dead copy that will silently rot.
  const referenced = new Set()
  for (const match of SOURCE.matchAll(/\bt\(\s*'([A-Za-z][A-Za-z0-9]*)'/gu)) referenced.add(match[1])
  for (const match of SOURCE.matchAll(/\bt\([^)]*?\?\s*'([A-Za-z][A-Za-z0-9]*)'\s*:\s*'([A-Za-z][A-Za-z0-9]*)'/gu)) {
    referenced.add(match[1])
    referenced.add(match[2])
  }
  for (const match of SOURCE.matchAll(/(?:labelKey|hintKey|titleKey):\s*'([A-Za-z][A-Za-z0-9]*)'/gu)) referenced.add(match[1])
  const unreachable = Object.keys(dicts.en).filter((key) => !referenced.has(key))
  assert.deepEqual(unreachable, [], `dictionary entries nothing reads: ${unreachable.join(', ')}`)
})

check('the placeholder used by saveFailed is present in both languages', () => {
  for (const language of languages) {
    const template = dicts[language].saveFailed
    assert.ok(template.includes('{message}'), `${language}.saveFailed must interpolate {message}: ${template}`)
  }
})

check('the product name stays untranslated so the card is findable', () => {
  assert.ok(SOURCE.includes("'TypeSafe (Jev)'"), 'the card title literal was removed or localized')
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
