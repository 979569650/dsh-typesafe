/**
 * Shared constants and the shipped defaults for dsh-typesafe.
 *
 * The settings card (lib/client.js) is a self-contained browser bundle that
 * cannot import this module, so it repeats the namespace string. Everything
 * else here is host-only.
 * @module dsh-typesafe/config
 */

/** Settings namespace registered with the harness settings service. */
export const SETTINGS_NS = 'typesafe'

/** Cordis plugin name; must match the `name` in cordis.patch.yml. */
export const PLUGIN_NAME = 'dsh-typesafe'

/** Credential reference the settings card writes and the tools resolve. */
export const DEFAULT_API_KEY_REF = 'TYPESAFE_API_KEY'

/** TypeSafe API origin; the evaluation endpoint is `${baseURL}/v1/systemone`. */
export const DEFAULT_BASE_URL = 'https://api.typesafe.ai'

/** Model alias resolving to the most recent stable release. */
export const DEFAULT_MODEL = 'jev-latest'

/** Published input price, USD per million input tokens (output is free). */
export const DEFAULT_INPUT_PRICE_PER_MTOK = 0.042

/**
 * Where the prompt section is placed among the harness's other sections.
 *
 * 700 sits between TEAM_POLICY (600) and PTC_ONLY (800): the band holding
 * BEHAVIOURAL RULES rather than tool descriptions. The shipped value used to be
 * 2750, which placed it mid-way through the tool catalogue — measured at offset
 * 10653 of a 17377-character prompt, the middle of a long context and the zone
 * where an instruction is most often skimmed past.
 *
 * Measured, not assumed: after the first field test showed the agent ignoring
 * the tools on a task that needed them, the section was inspected in the real
 * assembled prompt (`scripts/show-section.mjs`) to confirm where it actually
 * landed. Tool ordering carries no load semantics, but prompt ORDER does, since
 * sections render in ascending order.
 */
export const DEFAULT_PROMPT_ORDER = 700

/**
 * Tool results screened by the automatic guard.
 *
 * Only tools that bring *outside* text into the model's context belong here:
 * that is the one place a different architecture buys a genuinely independent
 * signal. Local reads are deliberately absent — screening them would add a
 * network hop per file for a threat the sandbox already addresses.
 *
 * Entries may be glob patterns. A hard-coded allowlist cannot keep up with a
 * deployment whose tool set is assembled from plugins, and the first field test
 * proved it: the agent read a web page through `read_page` (contributed by
 * another plugin) and the guard never saw it. Two defenses now cover that class
 * of miss — glob patterns, so one line covers a whole family, and a startup
 * audit that warns about any registered tool matching {@link INGEST_TOOL_HINT}
 * without being covered.
 */
export const DEFAULT_GUARD_TOOLS = Object.freeze([
  // The harness's own fetch/search tools.
  'web_fetch',
  'web_search',
  // Third-party page readers (modsearch, MCP fetch servers, scrapers).
  'read_page',
  'read_url',
  'browse',
  'scrape',
  // MCP fetch servers, matched by family so a renamed server still counts.
  'mcp__*__fetch',
  'mcp__*__fetch_content',
  '*fetch_content',
])

/**
 * Whether a tool name looks like it brings outside content into context.
 *
 * Used only for the startup audit, which WARNS about a plausible miss rather
 * than silently screening. The heuristic is intentionally generous: a false
 * warning costs one log line, while a missed content tool costs the guard's
 * entire value for that tool.
 */
export const INGEST_TOOL_HINT = /fetch|read_page|read_url|browse|crawl|scrape|http|reader/iu

/** The resolved settings shape before any user layer is applied. */
export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  apiKeyEnv: DEFAULT_API_KEY_REF,
  baseURL: DEFAULT_BASE_URL,
  model: DEFAULT_MODEL,
  timeoutMs: 30000,
  maxStateChars: 60000,
  inputPricePerMTok: DEFAULT_INPUT_PRICE_PER_MTOK,
  promptEnabled: true,
  promptOrder: DEFAULT_PROMPT_ORDER,
  guardEnabled: true,
  guardTools: [...DEFAULT_GUARD_TOOLS],
  guardWarnThreshold: 0.5,
  guardMinChars: 200,
  guardMaxChars: 6000,
})

/** A detached copy of the shipped defaults, safe to hand to the settings service. */
export function cloneDefaults() {
  return {
    ...DEFAULT_SETTINGS,
    guardTools: [...DEFAULT_GUARD_TOOLS],
  }
}

/** Round to a fixed number of decimals without carrying float noise into output. */
export function round(value, decimals = 4) {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}
