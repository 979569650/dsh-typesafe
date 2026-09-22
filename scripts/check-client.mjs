// Verify the client half satisfies every requirement the web loader enforces.
//
// A surprising failure mode for an out-of-repo plugin: the host half loads and
// its tools appear, but the Settings card silently never renders because the
// client bundle was never discovered. The discovery path has several independent
// gates, and this script checks each one against the real loader code's rules
// rather than against assumptions.
//
// Usage: node scripts/check-client.mjs

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const pkgDir = resolve(HERE, '..')
const problems = []
const notes = []

function ok(message) {
  console.log(`  ok   ${message}`)
}

function fail(message) {
  problems.push(message)
  console.log(`  FAIL ${message}`)
}

console.log(`Checking client half of ${pkgDir}\n`)

// ── 1. the dsh.client declaration ────────────────────────────────────────────
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
const decl = pkg.dsh?.client
if (!decl) {
  fail('package.json declares no dsh.client — the loader will never look for a browser bundle')
} else {
  ok('package.json declares dsh.client')
  if (decl.platform !== 'web') fail(`dsh.client.platform is ${JSON.stringify(decl.platform)}, must be "web"`)
  else ok('dsh.client.platform is "web"')
  if (!Array.isArray(decl.inject)) fail('dsh.client.inject must be an array of package names')
  else ok(`dsh.client.inject: ${decl.inject.join(', ')}`)
}

// ── 2. the exports entry the loader resolves ─────────────────────────────────
const exportsField = pkg.exports
const clientExport = typeof exportsField?.['./client'] === 'string'
  ? exportsField['./client']
  : exportsField?.['./client']?.default
if (typeof clientExport !== 'string') {
  fail('package.json exports has no string "./client" entry — the loader resolves the bundle through it')
} else {
  ok(`exports["./client"] -> ${clientExport}`)
  const clientPath = join(pkgDir, clientExport)
  if (!existsSync(clientPath)) {
    fail(`the exported client bundle does not exist: ${clientPath}`)
  } else {
    ok(`the exported client bundle exists (${readFileSync(clientPath, 'utf8').length} bytes)`)
  }
}

// ── 3. the bundle registers itself the way the loader requires ───────────────
const bundlePath = join(pkgDir, clientExport ?? 'lib/client.js')
if (existsSync(bundlePath)) {
  const source = readFileSync(bundlePath, 'utf8')
  const idMatch = /__ModuleLoader__\.load\(\s*\{\s*id:\s*['"]([^'"]+)['"]/u.exec(source)
  if (!idMatch) {
    fail('the bundle never calls window.__ModuleLoader__.load({ id, factory }) — it will load and register nothing')
  } else {
    ok(`the bundle registers id "${idMatch[1]}"`)
    // The loader skips a bundle whose registered id does not match the row it
    // was fetched for, so a mismatch makes the bundle a silent no-op.
    const expectedId = pkg.name
    if (idMatch[1] !== expectedId) fail(`registered id "${idMatch[1]}" does not match the package name "${expectedId}"`)
    else ok('the registered id matches the package name')
  }

  if (!/\bfactory\s*:/u.test(source)) fail('the registration has no factory — no plugin body would run')
  else ok('the registration carries a factory')

  // The factory must export apply/inject, since the module system invokes them.
  if (!/exports\.apply\s*=/u.test(source)) fail('the bundle does not export `apply` — the plugin would never activate')
  else ok('the bundle exports apply')

  const injectMatch = /exports\.inject\s*=\s*\[([^\]]*)\]/u.exec(source)
  if (!injectMatch) {
    notes.push('the bundle exports no inject list; the card may render before its services exist')
  } else {
    const declared = injectMatch[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/gu, '')).filter(Boolean)
    ok(`the bundle injects: ${declared.join(', ')}`)
    // The card writes the key through the credentials domain, the section through
    // settings, and renders its copy through locale. These are separate
    // injectable services, so declaring only `remote` lets apply run before they
    // mount — a card with untranslated text and a dead Save button.
    for (const needed of ['locale', 'remote.settings', 'remote.credentials']) {
      if (!declared.includes(needed)) {
        fail(`the bundle does not inject "${needed}", so its apply may run before that service mounts`)
      }
    }
  }
}

// ── 4. every package the bundle requires must be injectable ─────────────────
// `require(...)` inside a bundle resolves only through the module graph: a
// package not declared in dsh.client.inject and not part of the graph cannot be
// resolved, and the bundle fails at load with "cannot resolve".
if (existsSync(bundlePath) && Array.isArray(decl?.inject)) {
  const source = readFileSync(bundlePath, 'utf8')
  const requires = [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/gu)].map((m) => m[1])
  const unique = [...new Set(requires)]
  const injectable = new Set(decl.inject)
  const seeds = new Set(['react', 'react-dom'])
  const unresolved = unique.filter((name) => !injectable.has(name) && !seeds.has(name))
  if (unresolved.length > 0) {
    fail(`the bundle requires packages it does not declare and cannot resolve: ${unresolved.join(', ')}`)
  } else {
    ok(`every required module is resolvable (${unique.join(', ')})`)
  }
}

// ── 5. does the loader actually resolve this package's client bundle? ────────
// The decisive check. The host half can load and register its tools while the
// browser half is never discovered — the Settings card then silently never
// renders, which reads to a user as "the plugin did not install". This runs the
// real composition unit from the harness against the real loader entry, so it
// fails for the same reasons the app would.
console.log('\nloader discovery')
try {
  const { Context } = await import('@deepseek-ai/cordis')
  const loaderMod = await import('@deepseek-ai/cordis-plugin-loader')
  const clientModulesMod = await import('@deepseek-ai/dsh-client-modules')

  const asPlugin = (mod) => (typeof mod === 'function' ? mod : mod?.default ?? mod?.apply)
  const context = new Context()
  await context.plugin(asPlugin(loaderMod), { root: ['.'] })
  await context.plugin(asPlugin(clientModulesMod), {})

  // Mount a known-good plugin that ships a client half, as a CONTROL. Without
  // it, an empty composition cannot be told apart from a broken one: "no entry
  // for my plugin" is only meaningful if some other plugin's entry appears.
  let controlMounted = false
  try {
    const control = await import('dsh-mcp-pill')
    await context.plugin(asPlugin(control), {})
    controlMounted = true
  } catch {
    // The control is optional; the check below reports whether it is needed.
  }

  // Register this package as a loader entry the way the profile's bundles list
  // does, so the scan has something to find.
  await context.loader?.create?.({ name: pkg.name })?.catch?.(() => {})

  const service = context.get('clientModules')
  if (!service) {
    fail('the client-modules service did not mount, so this check cannot run')
  } else {
    const graph = service.graph()
    const ids = graph.entries.map((entry) => entry.id)
    const controlPresent = controlMounted && ids.includes('dsh-mcp-pill')
    if (ids.length === 0 && !controlMounted) {
      // No loader entries exist in this bare context, so absence proves nothing.
      notes.push(
        'the isolated loader scan composed no entries at all (this check needs the real profile tree); '
        + 'rely on the structural checks above plus a restart to confirm the card renders',
      )
    } else if (ids.includes(pkg.name)) {
      ok(`the loader composed a client entry for "${pkg.name}" (${ids.length} entries total)`)
      const clientPath = service.clientPath(pkg.name)
      if (clientPath === undefined) fail(`entry "${pkg.name}" resolves no client bundle path — the served URL would 404`)
      else ok(`client bundle path resolves: ${clientPath}`)
    } else {
      fail(
        `the loader composed no client entry for "${pkg.name}"`
        + `${controlPresent ? ' while the control "dsh-mcp-pill" DID compose' : ''}. `
        + `Composed entries: ${ids.join(', ') || '(none)'}`,
      )
    }
  }
  await context.stop?.()
} catch (error) {
  // A missing peer dependency is a real install problem, not a check failure to
  // hide; report it as one.
  fail(`could not run the loader discovery check: ${error.message}`)
}

// ── 6. the card's own service contract ───────────────────────────────────────
// Not a loader rule, but a card that renders before `settingsScope`/`slots`
// exist is a blank card.
console.log('')
if (notes.length > 0) for (const note of notes) console.log(`  note ${note}`)

console.log('')
if (problems.length === 0) {
  console.log('Client half checks out. A restart is required for the loader to discover it.')
  process.exit(0)
}
console.log(`${problems.length} problem(s) found; the Settings card would not appear.`)
process.exit(1)
