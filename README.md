# dsh-typesafe

TypeSafe **Jev** as a decision layer for DeepSeek Harness.

A reasoning model should not spend its context and its tokens on judgements that
are narrow, enumerable, and mechanical. Jev answers exactly those — cheaply,
with calibrated probabilities — and, being a different architecture, gives a
genuinely independent second signal where a same-family LLM reviewer would just
agree with itself.

This plugin wires that into DSH: three tools, a short prompt section that tells
the agent when the trade is worth making, an automatic prompt-injection guard
over untrusted tool results, and a cost meter so "cheaper" is a number you can
check instead of a claim you have to trust.

---

## What it does

| Piece | What it adds |
| --- | --- |
| `typesafe_decide` | Ask Jev 1–200 typed questions about one piece of content in a single call. Mix `noul` (yes/no probability), `choice` (pick one + full distribution), and `score` (rubric). |
| `typesafe_route` | Route content to one of a fixed set of destinations, returning the choice, every probability, and a confidence. `min_confidence` turns uncertainty into an explicit escalation flag. |
| `typesafe_screen` | Screen untrusted text for prompt injection and for how much harm acting on it would cause. |
| Prompt section | Three concrete rules telling the agent when Jev beats a reasoning call, and when it does not. Without this the tools exist but go unused. |
| Automatic guard | A `tools/post-execute` hook that screens results from `web_fetch`, `web_search`, `read_page` and the fetch MCP tools **before the model reads them**. Fail-open. |
| `/typesafe` | Session call count, input tokens, and estimated cost. |
| Localized card | The Settings card ships Chinese and English and follows **Settings → General → Language**. |

## Measured results

Real calls against `jev-latest`, not vendor claims:

| Check | Result |
| --- | --- |
| Three primitives in one call | urgency `0.98`; routing `technical` 0.81; frustration `1.04/2` |
| Latency / cost per call | ~800 ms, **$0.0000173** |
| Guard on a real injection string | **`blocked`**, injection 0.99, harm 2.34 |
| Guard on benign policy text | **`clear`** — no false positive, injection 0.01, harm 0.06 |
| Chinese input | urgency `0.98`, anger `1.9/2` — usable despite the docs calling CJK weaker |

Cost per screen: **$0.0000235**. The whole verification run cost **$0.000094**.

## Field test: did the agent use it on its own?

Three sessions, same task shape (28 Chinese support tickets to triage), differing
only in the prompt section's wording and order. The task never mentions TypeSafe,
so the section is the only thing that can make the agent reach for the plugin.

| Session | Section | TypeSafe calls | Outcome |
| --- | --- | --- | --- |
| 1 — 15 feedback items | old wording, order 2750 | 1 × `typesafe_decide`, 45 questions in one call | Worked |
| 2 — 28 tickets, `triage.py` | old wording, order 2750 | **0** | **Failed** |
| 3 — 28 tickets, `triage.py` | new wording, order 700 | 1 × `typesafe_decide`, 28 questions in one call | Worked |

### Why session 2 failed, and what changed

The old section opened with *"You have TypeSafe Jev available through three
tools"* — a description of an existence. Under a **coding-shaped** task ("write
triage.py") the agent went straight to writing keyword rules and never
reconsidered, even while reporting a 64% uncertain rate that these tools exist to
prevent. It had the need, it had the tool, and it did not connect them.

The rewrite replaces description with **recognition triggers** — the acts the
agent is about to perform itself:

> **Writing keyword rules, regex, or heuristics to classify text.** Before you
> build a word list, ask Jev.
>
> **Claiming which items are "uncertain" or "ambiguous".** Do not guess — low
> `confidence` IS the machine-readable form of "I am not sure".

`promptOrder` moved 2750 → 700, out of the tool catalogue and into the
behavioural-rule band (TEAM_POLICY 600 … PTC_ONLY 800). Measured: the section
went from offset 10653/17377 (**61%** into the prompt) to 6348/18352 (**35%**).

### What session 3 did with it

It did not ask Jev to classify — it used Jev to **audit its own rules**:

| Choice | Why it matters |
| --- | --- |
| State = the category definitions + all 28 tickets with the rule engine's verdict attached | Content and question separated, per the docs |
| Question = *"is this ticket's classification undisputed?"* | Auditing its own output, not outsourcing it |
| Four options: `certain` / `ambiguous` / `multi` / `both` | Splits "unsure" into two causes — the section only said "uncertain" |
| One call, one shared criteria set | Cheapest correct shape |

Then it used the probabilities to **overrule its own rule engine**: the keyword
layer flagged 15 items, Jev's distribution reduced that to 3 solid + 3 marginal,
identifying `004/009/016/022` as false positives caused by short text rather than
real ambiguity. It also found a real bug — the thank-you rule `收到` matching
"发票还没**收到**" — by cross-checking the two signals.

## Does it survive a long conversation?

The concern is fair: a fixed instruction inside a growing context gets diluted.
Measured against the session that produced this README — **2,239 records, 7.9 M
characters of conversation, roughly 430× the system prompt** — the answer is yes,
for three separate reasons:

**1. The system prompt is re-assembled per request, not accumulated.** Its size
across that session was 16561 → 17377 → 18351 chars (spread 1790) while the
conversation grew past 7.9 M. The conversation does not push the instruction out
of position.

**2. Compaction replaces conversation messages, never the system prompt.** The
checkpoint lands as `surfaceOp: { op: "replace", startSeq, endSeq }` over a
`user/message` span, and the session service **refuses by construction** any
replacement covering node 0.

That second claim is verified, not inferred. `test/compaction-survives.mjs` drives
the real `@deepseek-ai/dsh-session` surface machinery: it builds a session whose
node 0 is a system prompt carrying the section, appends a conversation, applies
the exact `replace` compaction uses, and asserts the prompt is byte-identical
afterwards. Then it attempts the adversarial variant — a replacement that swallows
node 0 along with the conversation — and asserts the service refuses it:

```
surface replace: node 0 holds the system prompt and may be rewritten
only by a system/message over exactly that node
surface seqs after : [0,1,2,3]   ← unchanged by the rejected attack
```

The same test asserts the positive control: a legitimate system-prompt refresh
*is* allowed when it targets node 0 alone, which is how an edited section reaches
a live session without a restart.

**3. Usage held up late in that same long session.** TypeSafe was called 12 times
in it: 9 early (the field tests) and **3 at 2,100+ records** (the guard code
audit). The later calls came after the conversation was already ~7 M characters.

**The one real drift, and its size.** Sections render in ascending order, so
anything with a lower order pushes the guidance later. The memory section
(order 50) is the grower: it renders pinned plus recent memories, and in that
session it occupied ~6,232 chars ahead of the plugin section. That drift is
bounded and small — 816 chars across a 2,239-record session — and `promptOrder`
700 leaves most of the behavioural band unused above it.

**What would actually break it**, stated so it can be watched rather than assumed:
a plugin rendering at order < 700 whose section grows unbounded (a very large
memory section, or a file-tree digest), and the section being re-ordered *after*
the tool catalogue again. `scripts/section-drift.mjs` and
`scripts/long-context-risk.mjs` measure both.

### Auditing any of this yourself

```bash
node scripts/audit-session.mjs <sessionId>       # calls + guard notices
node scripts/dump-call.mjs <sessionId>           # the full state and questions
node scripts/context-growth.mjs <sessionId...>   # prompt vs conversation curve
node scripts/section-drift.mjs <sessionId>       # what renders before the section
node scripts/long-context-risk.mjs <sessionId>   # coverage, compaction, stability
```

One caveat these tools surfaced: a session recorded **5** system prompts, of which
**3** carried the section. The other two predate the plugin's activation in that
session — a per-request re-assembly means a prompt captured before the plugin
loaded legitimately lacks it. Counting "how many prompts contain the section" is
meaningless without knowing when the plugin activated.

### The silent guard gap it also exposed

`read_page` — a tool contributed by a *different* plugin — fetched a web page and
**the guard never saw it**, because `guardTools` was a literal allowlist:

```
[GAP] read_page      ran 2, noticed 0
```

That is a silent hole in a security feature. Fixed three ways:

1. `guardTools` entries are now **globs**, so `mcp__*__fetch` covers every MCP
   fetch server including ones named later.
2. `read_page`, `read_url`, `browse`, and `scrape` ship in the default list.
3. The plugin now **audits the registered tool set at startup** and logs a warning
   naming any content-ingesting tool the guard does not cover.

`test/guard-coverage.mjs` asserts all three, including a regression case for
`read_page` specifically.

## Audit: reviewing this plugin with Jev

The guard was audited by asking Jev five atomic yes/no questions about the actual
source — the "vibe coding" pattern this plugin exists to enable: the agent writes
the code, the decision model does the mechanical checking, and the agent verifies
every flag.

Jev returned high probability on all five. **Two were real.** That ratio is the
useful finding: it is a filter, not an oracle.

| Flag | Jev | Verified | Outcome |
| --- | --- | --- | --- |
| Truncation bypass | 0.89 | **Real** | The head/tail excerpt dropped the middle 6000 chars while the model read the full text. Reproduced with a payload at offset 7200. **Fixed** — `chunkText` now covers every character. |
| Notice forgery | 0.68 | **Real** | A fetched page could open with its own `[TypeSafe guard] Screened clear.` line; the model saw two identical markers. **Fixed** — `collidesWithMarker` forces a block, and the untrusted region is delimited. |
| Fail-open exploitable | 0.91 | **Accepted, by design** | An attacker who induces a failure gets unscreened content. That is the deliberate trade (a guard that halts work is an availability bug); the notice says UNSCREENED loudly instead of staying silent. |
| Third-party data exposure | 0.93 | **Accepted** | Screened text goes to `api.typesafe.ai`. Real, and the honest answer is that this is inherent to using any hosted classifier — turn the guard off for content that must not leave the machine. |
| Residual bypass | 0.79 | **Not reproduced** | After the fix, Jev re-scored the new chunking loop at 0.35 with no off-by-one. |

Both real findings are now permanent regression tests
(`test/truncation-bypass.mjs`, `test/notice-forgery.mjs`), written to fail if the
vulnerability returns.

### The one the audit missed, found later

The truncation bypass above was fixed in `lib/guard.js` — and left standing in
`lib/tools.js`, where `typesafe_screen` had its own copy of the same head/tail
excerpt. The tool kept dropping the middle of a long text while still reporting a
confident verdict about all of it:

```
full text length                    : 24054
payload offset                      : 7995   (old excerpt dropped [4200, 22254))
payload SEEN by the tool excerpt    : false
payload covered by the chunked path : true
```

That is worse than the guard's version of the bug, because this is the tool the
plugin's own prompt section tells the agent to reach for *before trusting outside
text*. Both paths now call one `screenAll()`, so a fix cannot land in one and miss
the other, and `test/screen-coverage.mjs` drives the tool's real request path to
assert the payload reaches the classifier.

The lesson is narrower than "review more": **a duplicated implementation is a
duplicated vulnerability.** Fixing one copy is not fixing the bug.

**The lesson worth keeping:** ask several narrow questions rather than one broad
one, and treat each answer as a lead to investigate rather than a verdict. A 40%
hit rate on security flags is genuinely useful; a 40% hit rate accepted without
verification is worse than no review at all.

## What it deliberately does not do

- **It is not a model swap.** Jev cannot write prose, call tools, or hold a
  conversation. `model: "jev-latest"` will never power this agent. TypeSafe's own
  docs say so explicitly.
- **It does not think alongside the model.** Jev has no reasoning trace to
  contribute. Any design where it "thinks with" the agent misuses both.
- **The guard never blocks work.** It prepends an advisory verdict; the sandbox
  and approval seams still decide what may run. A guard that can halt work when
  Jev is unreachable converts an optional safety feature into an availability bug.

## Install

```bash
node scripts/install.mjs
```

This does three things, all of which must hold before the harness will load the
plugin:

1. Links this package's `node_modules` to the profile's, so the package's own
   imports resolve. A linked package is resolved at its real path, so Node would
   otherwise look in `dsh-typesafe/node_modules` — which does not exist in a
   source checkout.
2. `pnpm add link:<this dir>` in the profile, so the bundle loader can resolve
   the name. Edits here take effect without reinstalling.
3. Appends `dsh-typesafe` to `dsh.profile.bundles`, without which the loader
   never reads `cordis.patch.yml` and the row is never inserted.

Pass a profile directory explicitly for a non-default profile:

```bash
node scripts/install.mjs "%DSH_HOME%\profiles\desktop"
node scripts/install.mjs --uninstall
```

Then restart DSH (or let `patchReload: live` pick the row up).

## Configure the API key

Two paths. The card is the intended one; the script exists because the card can
be hard to find at the bottom of a long plugin list, and because a fresh profile
may need a key before the browser half is reachable at all.

### Settings card

**Settings → Plugins → Plugin configuration → TypeSafe.**

The card sits in the Plugins list among the other cards — scroll to the bottom,
it is ordered last. A green dot means a key is stored.

The key is written through the credentials store, not into `settings.yaml`. The
literal never rides a settings response, so the page can only ever report
*whether* a key exists.

### Script (no UI)

```bash
node scripts/set-key.mjs sk-your-key
node scripts/set-key.mjs --status
node scripts/set-key.mjs --unset
```

This patches `$DSH_HOME/.credentials.yaml` leaf-by-leaf through a real YAML
parser, so every other provider's key and your comments survive.

Either path takes effect on the **next tool call, with no restart**: credentials
are resolved per request rather than captured at boot.

You can also export `TYPESAFE_API_KEY` in the environment DSH is launched from.
The inherited environment wins over the stored key and is read-only.

Get a key at <https://console.typesafe.ai/keys>. New accounts include $5 of
promotional credit (TypeSafe's own estimate: ~119M input tokens).

Verify with:

```
/typesafe
```

## Verifying the install

The host half and the browser half fail independently, and both fail quietly. A
plugin can load its tools successfully while its Settings card never renders,
because the browser bundle is discovered by a separate scan.

After installing, confirm the host half loaded:

```powershell
Select-String -Path "$env:APPDATA\DSH Desktop\logs\host\dsh-*.log" -Pattern typesafe
```

A working install logs:

```
[I] [dsh-typesafe] dsh-typesafe: Jev tools registered (model jev-latest)
```

- **No such line** → the bundle was never discovered. Check `dsh.profile.bundles`
  in the profile's `package.json`.
- **Line present, no card** → the host half is fine and the *client* half was not
  found. Run `npm run test:client`, which checks each discovery gate against the
  real loader's rules.
- **A warning naming unscreened tools** → the guard-coverage audit found a
  content-ingesting tool outside `guardTools`. Add a pattern for it.

Both halves require a restart after install: the bundle list is read at boot and
the client scan runs against the composed tree.

## Auditing a session

The session store is the authoritative record of what the model was told and what
it called. These scripts read it directly, so a claim about behaviour can be
checked instead of taken on faith:

```bash
node scripts/audit-session.mjs <sessionId>        # tool-call census + guard notices
node scripts/inspect-typesafe-call.mjs <sessionId> # the exact questions and answers
node scripts/guard-coverage.mjs <sessionId>        # which content tools were not screened
node scripts/show-section.mjs                      # the prompt section as delivered
node scripts/prompt-evidence.mjs                   # was it in a system prompt at all
```

Two gotchas these encode, both of which produced wrong answers before:

- The store is **multi-frame zstd** (one frame per record). A single
  `zstdDecompressSync` returns only the first record — a 2 MB session decoded to
  191 bytes, which reads as "no evidence" rather than as an error.
- Searching a session for the prompt text gives a **false positive**: the same
  literal appears in the plugin's own source, so every read/write of
  `lib/index.js` matches. Only `system/message` records prove delivery.

## How the agent is expected to use it

The plugin's prompt section tells the agent:

> Reach for it when a judgement is narrow, enumerable, and mechanical — routing
> to one of a fixed set, scoring against a rubric you can state, or a yes/no
> determination. […] Ask several questions in ONE call. They run in parallel
> against the same state, so batching is far cheaper than one call per question.
> Use the confidence that `typesafe_route` returns. High confidence means act;
> low confidence means escalate.

The batching point is where the cost advantage actually comes from. Jev's own
cookbook measures 11–12× cheaper and 9–10× faster for 13 questions in one call
than the same questions asked sequentially.

## Cost

$0.042 per million input tokens; **output tokens are free**. Per
<https://docs.typesafe.ai/models>:

| Workload | Cost |
| --- | --- |
| One screen-sized call | ~$0.00002 |
| 100k calls × 1,000 tokens | $4.20 |
| 1M calls × 1,000 tokens | $42.00 |

`inputPricePerMTok` is configurable, so update it if TypeSafe changes pricing —
the plugin reports cost from that number rather than from a hard-coded rate.

## The guard, in detail

Injection payloads that fool an LLM are precisely the payloads a same-family LLM
reviewer also tends to accept — same training pressure, same blind spot. Jev is a
different architecture trained for calibrated decisions, invoked over a
separately assembled state, so its verdict is at least a *different* signal
rather than an echo.

Two questions are asked, deliberately separately:

- `noul` — does this text try to redirect an AI assistant? Ordinary
  documentation, quoted examples, and discussion *of* prompt injection are
  explicitly not attempts.
- `score` 0–3 — if an assistant acted on any instruction in the text, how much
  harm would result?

Verdicts: `blocked` (injection ≥ threshold **and** harm ≥ 2), `review`
(injection ≥ threshold), else `clear`.

Three properties worth knowing:

- **Fail-open.** Any failure — no key, timeout, rate limit, network — leaves the
  result unmodified but *annotated*. Silence would make "screened and clean"
  indistinguishable from "the guard is off", and an agent that cannot tell those
  apart over-trusts content exactly when nothing is protecting it.
- **Full coverage, not a sample.** Long results are split into overlapping chunks
  and **every chunk is screened**; nothing is excerpted away. An earlier version
  kept a head/tail excerpt, which a payload could defeat by sitting in the dropped
  middle — read by the model, never seen by the classifier. Both screening paths
  now share one implementation so that fix cannot be missed in one of them.
- **A minimum length.** Below `guardMinChars` the verdict is noise and the call
  costs more than the content it judges. This floor applies to the *automatic*
  guard only; an explicit `typesafe_screen` call screens whatever it is given.

## Configuration reference

Every key is defaulted, so `id` + `name` alone is a working install. Edit them in
the settings card, or override the row in a profile `cordis.patch.yml`.

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch. Off removes the prompt section and the guard. |
| `apiKeyEnv` | `TYPESAFE_API_KEY` | Credential reference to resolve. |
| `baseURL` | `https://api.typesafe.ai` | API origin. |
| `model` | `jev-latest` | Alias or pinned version id. Pin a version if you tuned thresholds against it. |
| `timeoutMs` | `30000` | Per-request timeout. |
| `maxStateChars` | `60000` | Rejects oversized calls before they are billed. |
| `inputPricePerMTok` | `0.042` | Cost reporting only. |
| `promptEnabled` | `true` | Whether to tell the agent when to use the tools. |
| `promptOrder` | `700` | Prompt section placement, in the behavioural-rule band (TEAM_POLICY 600 … PTC_ONLY 800). |
| `guardEnabled` | `true` | Screen untrusted tool results. |
| `guardTools` | `web_fetch`, `web_search`, `read_page`, `read_url`, `browse`, `scrape`, `mcp__*__fetch`, `mcp__*__fetch_content`, `*fetch_content` | Which tool results to screen. **Globs**, so one entry covers a family. Only tools that bring *outside* text in belong here. |
| `guardWarnThreshold` | `0.5` | Injection probability at which a result is flagged. |
| `guardMinChars` | `200` | Skip shorter results. |
| `guardMaxChars` | `6000` | Chunk size for screening. Every chunk is screened, so this trades request count against request size — it is not an excerpt budget. |

## Tests

```bash
npm test              # offline: request construction, schema, guard text, wiring, localization
npm run test:runtime  # boots the plugin under the real Cordis runtime
npm run test:security # the audit findings, as regression tests
npm run test:client   # checks client-bundle discovery against the real loader
npm run test:live     # real calls; needs TYPESAFE_API_KEY
```

`test/truncation-bypass.mjs`, `test/screen-coverage.mjs`, and
`test/notice-forgery.mjs` are regression tests for three real vulnerabilities
found during the Jev audit (see above). They assert the security invariant rather
than the implementation: the truncation test sweeps a payload across every
position at five chunk sizes, the screen-coverage test drives the tool's real
request path with a stubbed transport and asserts the payload reaches the
classifier, and the forgery test asserts marker imitation forces a block and that
the untrusted region stays delimited.

`test/screen-coverage.mjs` exists because the truncation fix was applied to the
guard and *not* to the `typesafe_screen` tool — the same defect survived in a
second implementation of the same idea. Both paths now call one function, and
this test fails if a tool-path excerpt ever returns.

`test/locale.mjs` exists because a missing translation is invisible until a user
sees it: a key present in one language and absent in the other renders as the raw
key name, which reads as a broken build. The check asserts both dictionaries
declare identical keys, that every `t()` reference resolves, and that no entry is
dead copy.

`test/runtime.mjs` is the one that matters most. It composes a real Cordis app
with the real tool registry, settings provider, credentials store, and
system-prompt service, then applies the plugin and asserts on what came out: the
three tools are visible to the model, each projects to a valid wire schema, the
settings namespace registers and round-trips a write through the real provider,
an invalid write is refused, the prompt section renders, and the guard actually
fires end-to-end through the tool pipeline. It starts no web server and no
session, so it is safe beside a live DSH.

`test/live.mjs` measures the things no offline test can: that TypeSafe accepts
the request shape, that the response matches what the plugin assumes, the real
per-call cost, whether the guard separates a real injection from benign text,
and how Jev handles Chinese input — which TypeSafe documents as weaker than
English. Its guard samples are deliberately long enough to clear `guardMinChars`;
a shorter sample would exercise the length filter rather than the classifier and
report "not screened", which is not a passing result.

## Measured limits

TypeSafe is young and open about this. Treat these as facts to plan around, not
as objections:

- **GA in September 2026**, days old at the time of writing. Rate limits and
  pricing are documented as changing dynamically.
- **Accuracy 67.8%** on TypeSafe's own published benchmark vs 74.1% for its best
  LLM comparator. Jev wins on cost, speed, and routable confidence — not on raw
  accuracy. Measure it on your own data before depending on it.
- **English is the primary training language.** CJK is handled but not equally
  well; test before relying on it in Chinese.
- **Input is text only.** No image, audio, or video.
- All vendor performance claims (193× faster, 444× cheaper) are vendor-reported
  and not independently verified. The third-party price sites
  (`jevtypesafeai.com`, `jevplayground.com`, `explainx.ai`) are unofficial.

## Layout

```
lib/config.js             shared constants and shipped defaults
lib/jev.js                the wire client: request build, validation, cost accounting
lib/guard.js              the injection screen, chunking, and verdict rendering
lib/tools.js              the three model-facing tools
lib/index.js              plugin entry: settings, credentials, prompt, tools, guard, command
lib/client.js             browser half: the settings card that owns the API key
scripts/lib/session-store.mjs  shared session-store reader for the audit scripts
```

`scripts/lib/session-store.mjs` is not shipped (only `lib/` is published) and is
never imported at runtime. It exists because ten audit scripts each carried their
own copy of the same multi-frame zstd reader — including the subtlety that a
single `zstdDecompressSync` call decodes only the first frame, which turns a real
session into a silent false negative. One copy, one place to be right.

## License

MIT.
