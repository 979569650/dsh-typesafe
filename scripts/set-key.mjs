// Set the TypeSafe API key in the harness credential store without the UI.
//
// The Settings card is the intended path, but a key can be written directly and
// the running DSH picks it up on the next call: credentials are resolved per
// request, not captured at boot. This exists so a key can be installed before
// the card is reachable at all — on a fresh profile, or when the card list is
// long enough that the card is hard to find.
//
// Usage:
//   node scripts/set-key.mjs sk-your-key
//   node scripts/set-key.mjs --unset
//   node scripts/set-key.mjs --status

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { parseDocument } from 'yaml'

const REF = 'TYPESAFE_API_KEY'
const home = process.env.DSH_HOME || join(homedir(), '.dsh')
const file = process.env.TYPESAFE_CREDENTIALS_FILE || join(home, '.credentials.yaml')

/**
 * Load the document into a comment-preserving tree. The credentials document is
 * shared with every other provider, so rewriting it wholesale would drop other
 * keys and the user's comments — the same reason the harness itself patches it
 * leaf-by-leaf under a writer lock.
 */
function load() {
  if (!existsSync(file)) return parseDocument('version: 1\nrefs: {}\n')
  return parseDocument(readFileSync(file, 'utf8'), { prettyErrors: true })
}

const args = process.argv.slice(2)

if (args.includes('--status')) {
  if (!existsSync(file)) {
    console.log(`No credentials document at ${file}`)
    process.exit(0)
  }
  const doc = parseDocument(readFileSync(file, 'utf8'))
  const value = doc.getIn(['refs', REF])
  console.log(`Document: ${file}`)
  console.log(value === undefined ? `${REF}: not set` : `${REF}: set (${String(value).length} chars)`)
  process.exit(0)
}

if (args.includes('--unset')) {
  if (!existsSync(file)) {
    console.log('Nothing to unset; no credentials document exists.')
    process.exit(0)
  }
  const doc = load()
  if (doc.getIn(['refs', REF]) === undefined) {
    console.log(`${REF} is not set; nothing changed.`)
    process.exit(0)
  }
  doc.deleteIn(['refs', REF])
  writeFileSync(file, doc.toString())
  console.log(`Removed ${REF} from ${file}`)
  console.log('Running DSH resolves credentials per request, so this takes effect on the next tool call.')
  process.exit(0)
}

const key = args.find((a) => !a.startsWith('--'))
if (!key) {
  console.error('usage: node scripts/set-key.mjs <api-key> | --unset | --status')
  console.error('')
  console.error('Get a key at https://console.typesafe.ai/keys')
  process.exit(2)
}

// A key pasted with surrounding whitespace or quotes is the single most common
// cause of a 401 that looks like a wrong key.
const cleaned = key.trim().replace(/^["']|["']$/gu, '')
if (cleaned.length === 0) {
  console.error('The key is blank after trimming.')
  process.exit(2)
}
if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true })

const doc = load()
if (!doc.has('version')) doc.set('version', 1)
doc.setIn(['refs', REF], cleaned)
writeFileSync(file, doc.toString())

console.log(`Wrote ${REF} to ${file} (${cleaned.length} chars).`)
console.log('')
console.log('Running DSH resolves credentials per request, so this takes effect on the next tool call —')
console.log('no restart needed. Confirm with /typesafe in the session.')
