/**
 * Shared reader for the DSH session store — used by the audit scripts.
 *
 * Every script under `scripts/` that inspects a session needs the same three
 * things: find a session directory, decode its records, and locate the region of
 * a record that carries the plugin's prompt section. They used to carry their
 * own copies, which is how the same subtle bug survived in nine places at once.
 *
 * The subtlety worth stating once, loudly, because getting it wrong produces a
 * confident FALSE NEGATIVE rather than an error:
 *
 *   The store is MULTI-FRAME zstd — one frame per record. A single
 *   `zstdDecompressSync(bytes)` returns only the FIRST frame. On a real session
 *   that decoded a 2 MB file to 191 bytes, which every caller then reported as
 *   "the prompt is not here" rather than as a decoding failure.
 *
 * It is not a library the plugin ships: nothing here is imported at runtime, and
 * `package.json` publishes only `lib/`. It exists for the audit tooling.
 * @module dsh-typesafe/scripts/session-store
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { zstdDecompressSync } from 'node:zlib'

/** The zstd frame magic number, used to split a multi-frame file. */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** A session file's name prefix; the store may hold a live and a sealed file. */
const SESSION_PREFIX = 'session.'

/** The root of the session store for this machine. */
export function sessionRoot() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'sessions')
}

/**
 * Decode one session file into concatenated JSONL text.
 *
 * Frames are split on the magic number and decoded one at a time; a frame that
 * fails to decode is skipped rather than aborting the read, because a session
 * being written right now normally ends in a truncated frame.
 *
 * @param {string} file - path to a session file.
 * @returns {string} the concatenated JSONL text.
 */
export function readSessionFile(file) {
  const bytes = readFileSync(file)
  if (!file.endsWith('.zstd')) return bytes.toString('utf8')

  const offsets = []
  for (let at = bytes.indexOf(ZSTD_MAGIC); at !== -1; at = bytes.indexOf(ZSTD_MAGIC, at + 4)) offsets.push(at)
  if (offsets.length <= 1) return zstdDecompressSync(bytes).toString('utf8')

  const parts = []
  for (let i = 0; i < offsets.length; i += 1) {
    const end = i + 1 < offsets.length ? offsets[i + 1] : bytes.length
    try {
      parts.push(zstdDecompressSync(bytes.subarray(offsets[i], end)).toString('utf8'))
    } catch {
      // The live tail frame is routinely truncated mid-write.
    }
  }
  return parts.join('\n')
}

/**
 * Parse every JSONL record across several session files, in order.
 * A line that does not parse is skipped: a partially written record is normal.
 * @param {string[]} files - session file paths.
 * @returns {object[]} the parsed records.
 */
export function recordsFrom(files) {
  const records = []
  for (const file of files) {
    for (const line of readSessionFile(file).split('\n')) {
      if (!line.trim()) continue
      try {
        records.push(JSON.parse(line))
      } catch {
        // A truncated tail line while a session is live.
      }
    }
  }
  return records
}

/** The session files inside one directory, in name order. */
function filesIn(dir) {
  return readdirSync(dir)
    .filter((name) => name.startsWith(SESSION_PREFIX))
    .map((name) => join(dir, name))
}

/**
 * Every session directory, newest first.
 * @returns {{dir: string, files: string[], mtime: number}[]} the sessions.
 */
export function listSessions() {
  const root = sessionRoot()
  if (!existsSync(root)) return []
  const found = []
  for (const workspace of readdirSync(root, { withFileTypes: true })) {
    if (!workspace.isDirectory()) continue
    const wsDir = join(root, workspace.name)
    for (const session of readdirSync(wsDir, { withFileTypes: true })) {
      if (!session.isDirectory()) continue
      const dir = join(wsDir, session.name)
      const files = filesIn(dir)
      if (files.length === 0) continue
      const newest = files.map((f) => statSync(f).mtimeMs).reduce((a, b) => Math.max(a, b), 0)
      found.push({ dir, files, mtime: newest })
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime)
}

/**
 * Find one session by a fragment of its id.
 * @param {string} fragment - any substring of the session directory name.
 * @returns {{dir: string, files: string[]}|undefined} the session, when found.
 */
export function locateSession(fragment) {
  const root = sessionRoot()
  if (!existsSync(root)) return undefined
  for (const workspace of readdirSync(root, { withFileTypes: true })) {
    if (!workspace.isDirectory()) continue
    const wsDir = join(root, workspace.name)
    for (const session of readdirSync(wsDir, { withFileTypes: true })) {
      if (!session.isDirectory() || !session.name.includes(fragment)) continue
      const dir = join(wsDir, session.name)
      const files = filesIn(dir)
      if (files.length > 0) return { dir, files }
    }
  }
  return undefined
}

/**
 * Resolve a script argument into a session.
 *
 * An argument that names a session DIRECTORY is used as given; otherwise it is
 * treated as an id fragment, and with no argument at all the newest session wins.
 * @param {string} [arg] - a directory path or an id fragment.
 * @returns {{dir: string, files: string[]}|undefined} the session, when found.
 */
export function resolveSession(arg) {
  if (arg !== undefined && existsSync(arg) && statSync(arg).isDirectory()) {
    return { dir: arg, files: filesIn(arg) }
  }
  if (arg !== undefined && arg.length > 0) return locateSession(arg)
  return listSessions()[0]
}

/**
 * Walk a value depth-first and return the first string satisfying a predicate.
 *
 * The system prompt lives at a nesting depth that varies by harness version, so
 * every caller needs this rather than a fixed path.
 * @param {unknown} value - the value to walk.
 * @param {(text: string) => boolean} predicate - test for a candidate string.
 * @returns {string|undefined} the first matching string.
 */
export function firstString(value, predicate) {
  if (typeof value === 'string') return predicate(value) ? value : undefined
  if (Array.isArray(value)) {
    for (const entry of value) {
      const hit = firstString(entry, predicate)
      if (hit !== undefined) return hit
    }
    return undefined
  }
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) {
      const hit = firstString(entry, predicate)
      if (hit !== undefined) return hit
    }
  }
  return undefined
}

/** The record type, whichever field this harness version uses. */
export function recordType(record) {
  return record?.type ?? record?.kind ?? ''
}

/**
 * Every recorded system prompt that carries one of the given markers.
 *
 * A session records a NEW `system/message` each time the prompt is reassembled,
 * so this sequence is what shows whether the section's text or its position ever
 * drifted. Classifying by record type is essential: the marker also appears in
 * the plugin's own source as it passes through tool traffic, so a plain
 * substring search over a session gives false positives.
 * @param {object[]} records - the session records.
 * @param {string[]} markers - marker strings, any of which identifies the section.
 * @returns {{seq: number, text: string, offset: number, marker: string}[]} the prompts.
 */
export function systemPromptsCarrying(records, markers) {
  const out = []
  let seq = 0
  for (const record of records) {
    seq += 1
    if (recordType(record) !== 'system/message') continue
    const marker = markers.find((m) => JSON.stringify(record).includes(m))
    if (marker === undefined) continue
    const text = firstString(record, (s) => s.includes(marker))
    if (text === undefined) continue
    out.push({ seq, text, offset: text.indexOf(marker), marker })
  }
  return out
}
