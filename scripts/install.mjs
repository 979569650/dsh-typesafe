/**
 * Install dsh-typesafe into a DSH profile.
 *
 * Three things have to be true before the harness will load this plugin, and
 * all three live outside this package:
 *
 *   1. The profile's `node_modules` must contain the package, so the bundle
 *      loader can resolve the name. Installed as a `link:` dependency, so edits
 *      here take effect without reinstalling.
 *   2. The package must resolve its own imports (`@deepseek-ai/schemastery`,
 *      `@deepseek-ai/dsh-tools`, …). A linked package is resolved at its real
 *      path, so Node starts looking in `dsh-typesafe/node_modules` — which does
 *      not exist in a source checkout. A junction to the profile's
 *      `node_modules` supplies every harness package at once, and is exactly
 *      right for a plugin that treats them as peers.
 *   3. The profile must list the package in `dsh.profile.bundles`, or the loader
 *      never reads its `cordis.patch.yml` and the row is never inserted.
 *
 * Usage:
 *   node scripts/install.mjs                 # default profile
 *   node scripts/install.mjs <profile-dir>   # explicit profile
 *   node scripts/install.mjs --uninstall
 */

import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR = resolve(HERE, '..')
const PACKAGE_NAME = 'dsh-typesafe'

/** The bundle list a profile keeps its ordered plugin set in. */
function readManifest(profileDir) {
  return JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
}

/** Write the profile manifest back with a stable two-space layout. */
function writeManifest(profileDir, manifest) {
  writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}

/** Whether a path exists as anything, including a junction or symlink. */
function exists(path) {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

/** Run one command, failing loud with its output rather than continuing blind. */
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`)
  }
}

const args = process.argv.slice(2)
const uninstall = args.includes('--uninstall')
const profileArg = args.find((a) => !a.startsWith('--'))
const profileDir = resolve(profileArg ?? join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'profiles', 'desktop'))

if (!exists(join(profileDir, 'package.json'))) {
  console.error(`Not a DSH profile (no package.json): ${profileDir}`)
  console.error('Pass the profile directory explicitly, e.g. node scripts/install.mjs "%DSH_HOME%\\profiles\\desktop"')
  process.exit(2)
}

console.log(`Profile: ${profileDir}`)
console.log(`Package: ${PACKAGE_DIR}\n`)

const manifest = readManifest(profileDir)
const bundles = manifest.dsh?.profile?.bundles
if (!Array.isArray(bundles)) {
  console.error('Profile manifest has no dsh.profile.bundles array; refusing to guess where to register.')
  process.exit(2)
}

// ── uninstall ────────────────────────────────────────────────────────────────

if (uninstall) {
  const next = bundles.filter((entry) => entry !== PACKAGE_NAME)
  if (next.length !== bundles.length) {
    manifest.dsh.profile.bundles = next
    if (manifest.dependencies && PACKAGE_NAME in manifest.dependencies) {
      delete manifest.dependencies[PACKAGE_NAME]
    }
    writeManifest(profileDir, manifest)
    console.log(`Removed ${PACKAGE_NAME} from bundles and dependencies.`)
  } else {
    console.log(`${PACKAGE_NAME} was not registered.`)
  }
  const link = join(PACKAGE_DIR, 'node_modules')
  if (exists(link)) {
    rmSync(link, { recursive: true, force: true })
    console.log(`Removed local node_modules link: ${link}`)
  }
  const installed = join(profileDir, 'node_modules', PACKAGE_NAME)
  if (exists(installed)) {
    rmSync(installed, { recursive: true, force: true })
    console.log(`Removed ${installed}`)
  }
  console.log('\nUninstalled. Restart DSH (or let patchReload pick it up) for the tools to disappear.')
  process.exit(0)
}

// ── step 1: make this package's own imports resolvable ───────────────────────
// The junction must exist before the profile resolves the package, because the
// loader imports it during boot.

const localModules = join(PACKAGE_DIR, 'node_modules')
if (exists(localModules)) {
  console.log(`Step 1: ${localModules} already exists; leaving it alone.`)
} else {
  mkdirSync(PACKAGE_DIR, { recursive: true })
  const target = join(profileDir, 'node_modules')
  // A junction on Windows and a symlink elsewhere; both need no elevation for
  // this direction, and both make every harness package reachable at once.
  const kind = process.platform === 'win32' ? 'Junction' : undefined
  try {
    if (process.platform === 'win32') {
      const result = spawnSync('cmd', ['/c', 'mklink', '/J', localModules, target], { stdio: 'pipe', shell: false })
      if (result.status !== 0) throw new Error(result.stderr?.toString() || 'mklink failed')
    } else {
      const { symlinkSync } = await import('node:fs')
      symlinkSync(target, localModules, kind)
    }
    console.log(`Step 1: linked ${localModules} -> ${target}`)
  } catch (error) {
    console.error(`Step 1 FAILED: could not link node_modules.`)
    console.error(`  ${error.message}`)
    console.error('  Run this script with permission to write outside the workspace, then retry.')
    process.exit(1)
  }
}

// ── step 2: install into the profile ─────────────────────────────────────────

console.log('\nStep 2: pnpm add link:...')
run('pnpm', ['add', `link:${PACKAGE_DIR}`], profileDir)

// ── step 3: register the bundle ──────────────────────────────────────────────

console.log('\nStep 3: register the bundle')
const fresh = readManifest(profileDir)
if (fresh.dsh.profile.bundles.includes(PACKAGE_NAME)) {
  console.log(`Step 3: ${PACKAGE_NAME} already in bundles.`)
} else {
  fresh.dsh.profile.bundles.push(PACKAGE_NAME)
  writeManifest(profileDir, fresh)
  console.log(`Step 3: added ${PACKAGE_NAME} to dsh.profile.bundles`)
}

console.log('\nInstalled. Next:')
console.log(`  1. Paste a TypeSafe API key at Settings > Plugins > Plugin configuration > TypeSafe`)
console.log(`     (or set TYPESAFE_API_KEY in the environment DSH is launched from).`)
console.log(`  2. Restart DSH, or let patchReload: live pick the row up.`)
console.log(`  3. Verify with: /typesafe`)
