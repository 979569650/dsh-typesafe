// dsh-typesafe — client half (official __ModuleLoader__ web bundle)
//
// Browser-only bundle: consumed by the DSH web loader (window.__ModuleLoader__).
// Not importable in Node.
//
// Renders one expandable Settings card under settings.plugin.item / key
// `typesafe`. The card owns the two things a user actually needs to touch:
//
//   1. The TypeSafe API key. It never rides a settings response — the settings
//      section stores only the *reference* (TYPESAFE_API_KEY) while the literal
//      lives in the credentials store, so the card learns whether a key is
//      configured and writes it through the credentials domain.
//   2. The guard switch and thresholds, which change agent behaviour and so
//      belong somewhere visible rather than only in a patch file.
//
// Everything else (endpoint, model, price) is editable too, because a price or
// alias change should not require editing YAML — but it is defaulted, so a user
// who only wants to paste a key never has to look at it.
//
// Localization: every user-visible string lives in DICTS and is read through
// `ctx.locale`. The card therefore follows Settings → General → Language instead
// of fixing one language — a Chinese-only card is unreadable to an English user
// and vice versa. Both shipped languages are registered here, so the card works
// on any build that has the locale service mounted.
//
// A note on style: this file deliberately recreates the official card chrome
// rather than importing it. An out-of-repo plugin bundle cannot import the
// harness's own client packages (bundle purity), so the chrome is reproduced
// and prefixed `dts` to avoid colliding with any other plugin's classes.

window.__ModuleLoader__.load({
  id: 'dsh-typesafe',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const e = React.createElement

    /** Settings namespace; must match SETTINGS_NS in lib/config.js. */
    const NS = 'typesafe'
    /** Credential reference; must match DEFAULT_API_KEY_REF in lib/config.js. */
    const DEFAULT_KEY_REF = 'TYPESAFE_API_KEY'

    // ── copy ─────────────────────────────────────────────────────────────────
    // One entry per user-visible string, in every shipped language. Keys are
    // shared across languages, and `test/locale.mjs` asserts the two dictionaries
    // stay in step: a key present in one language and missing in the other
    // renders as the raw key name, which looks like a broken build to a user.

    const DICTS = {
      zh: {
        summaryConfigured: '已配置密钥 · 工具可用',
        summaryMissing: '尚未配置密钥',

        apiKey: 'API 密钥',
        apiKeyPlaceholderStored: '••••••••（已保存 — 输入新值可替换）',
        apiKeyPlaceholderEmpty: '粘贴你的 TypeSafe API 密钥',
        apiKeyConfigured: '已配置密钥。它存储在设置文件之外，也不会发送到本页面。',
        apiKeyMissing: '尚未配置密钥 —— 在此之前所有 TypeSafe 工具都会失败。可在 console.typesafe.ai/keys 获取。',
        apiKeyReadOnly: '密钥由启动环境以只读方式提供。',
        apiKeyStorageHint: '写入凭据库，不写入 settings.yaml。',

        groupConnection: '连接',
        groupGuard: '自动护栏',
        groupBehaviour: 'Agent 行为',

        fieldEndpoint: '接口地址',
        fieldEndpointHint: 'TypeSafe API 地址。留空则使用官方地址。',
        fieldModel: '模型',
        fieldModelHint: '模型别名或版本号。若阈值是针对某个版本调好的，建议锁定该版本。',
        fieldPrice: '输入价格（美元 / 百万 tokens）',
        fieldPriceHint: '仅用于估算调用成本。输出 token 免费。TypeSafe 调价后请更新。',
        fieldGuardEnabled: '筛查不可信的工具结果',
        fieldGuardEnabledHint: '让 Jev 在模型读取之前检查网页 / MCP 结果是否含提示注入。失败放行：Jev 不可达时结果不筛查直接通过。',
        fieldGuardThreshold: '注入告警阈值（0-1）',
        fieldGuardThresholdHint: '达到或超过该概率即标记。值越低越敏感，告警也越多。',
        fieldGuardMin: '筛查的最小长度（字符）',
        fieldGuardMinHint: '更短的结果会跳过：判断结果没有意义，而这次调用的成本高于它要判断的内容。',
        fieldGuardMax: '筛查分块长度（字符）',
        fieldGuardMaxHint: '过长的结果会切成互相重叠的分块并逐块送检，覆盖每一个字符，不做截断。',
        fieldPrompt: '告诉 Agent 何时使用这些工具',
        fieldPromptHint: '添加一小段系统提示，说明这些工具的作用以及何时比普通 LLM 调用更合适。',
        fieldTimeout: '请求超时（毫秒）',
        fieldTimeoutHint: '作用于每一次 Jev 调用。',
        fieldMaxState: 'state 最大长度（字符）',
        fieldMaxStateHint: '在计费之前拒绝过大的调用。',

        overridden: '已覆盖',
        reset: '恢复默认',
        readOnly: '本部署的设置为只读。',
        invalidNumber: '请填数字，或恢复默认值。',
        discard: '放弃修改',
        save: '保存',
        saving: '保存中…',
        fixInvalid: '请修正无效值',
        saveFailed: '保存失败：{message}',

        credentialsUnavailable: '凭据服务不可用',
        credentialWriteRejected: '凭据写入被拒绝',
        settingsWriteRejected: '设置写入被拒绝',
      },

      en: {
        summaryConfigured: 'Key configured · tools available',
        summaryMissing: 'No API key yet',

        apiKey: 'API key',
        apiKeyPlaceholderStored: '•••••••• (stored — type to replace)',
        apiKeyPlaceholderEmpty: 'Paste your TypeSafe API key',
        apiKeyConfigured: 'A key is configured. It is stored outside the settings file and never sent to this page.',
        apiKeyMissing: 'No key configured — every TypeSafe tool will fail until one is. Get one at console.typesafe.ai/keys.',
        apiKeyReadOnly: 'The key is supplied read-only by the launching environment.',
        apiKeyStorageHint: 'Written to the credentials store, not to settings.yaml.',

        groupConnection: 'Connection',
        groupGuard: 'Automatic guard',
        groupBehaviour: 'Agent behaviour',

        fieldEndpoint: 'Endpoint',
        fieldEndpointHint: 'TypeSafe API origin. Leave empty for the official endpoint.',
        fieldModel: 'Model',
        fieldModelHint: 'Model alias or versioned id. Pin a version if you tuned thresholds against it.',
        fieldPrice: 'Input price (USD per 1M tokens)',
        fieldPriceHint: 'Used only to report call cost. Output tokens are free. Update when TypeSafe changes pricing.',
        fieldGuardEnabled: 'Screen untrusted tool results',
        fieldGuardEnabledHint: 'Ask Jev to check web/MCP results for prompt injection before the model reads them. Fail-open: if Jev is unreachable the result passes through unscreened.',
        fieldGuardThreshold: 'Injection alert threshold (0-1)',
        fieldGuardThresholdHint: 'At or above this probability the result is flagged. Lower catches more and warns more often.',
        fieldGuardMin: 'Minimum length to screen (characters)',
        fieldGuardMinHint: 'Shorter results are skipped: the verdict is noise and the call costs more than the content it judges.',
        fieldGuardMax: 'Screening chunk size (characters)',
        fieldGuardMaxHint: 'Long results are split into overlapping chunks and every chunk is screened, so no character is skipped.',
        fieldPrompt: 'Tell the agent when to use these tools',
        fieldPromptHint: 'Adds a short system-prompt section describing the tools and when they beat a normal LLM call.',
        fieldTimeout: 'Request timeout (ms)',
        fieldTimeoutHint: 'Applies to each Jev call.',
        fieldMaxState: 'Maximum state length (characters)',
        fieldMaxStateHint: 'Rejects oversized calls before they are billed.',

        overridden: 'overridden',
        reset: 'reset',
        readOnly: 'This deployment stores settings read-only.',
        invalidNumber: 'Enter a number, or reset to the default.',
        discard: 'Discard',
        save: 'Save',
        saving: 'Saving…',
        fixInvalid: 'Fix invalid value',
        saveFailed: 'Save failed: {message}',

        credentialsUnavailable: 'credentials service unavailable',
        credentialWriteRejected: 'credential write rejected',
        settingsWriteRejected: 'settings write rejected',
      },
    }

    // ── CSS ───────────────────────────────────────────────────────────────────
    // Injected once, tracked by a data attribute so a reload replaces rather
    // than duplicates it, and removed by the plugin disposer.

    const STYLE_ID = 'dsh-typesafe-card-css'

    const CSS = `
.dtsCard{border:.5px solid var(--dsw-alias-border-l4);border-radius:16px;padding:12px 14px;display:flex;flex-direction:column;gap:12px;list-style:none}
.dtsHeader{align-items:center;gap:10px;display:flex;width:100%;background:0 0;border:0;font:inherit;cursor:pointer;padding:0;text-align:left;color:var(--dsw-alias-label-primary)}
.dtsHeadText{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.dtsName{font-size:14px;font-weight:500;line-height:22px}
.dtsDescription{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dtsDot{border-radius:50%;flex:none;width:8px;height:8px;display:inline-block}
.dtsDotOn{background:var(--dsw-alias-state-success-primary)}
.dtsDotOff{background:var(--dsw-alias-state-error-primary)}
.dtsChevron{color:var(--dsw-alias-label-tertiary);font-size:12px}
.dtsBody{display:flex;flex-direction:column;gap:14px}
.dtsReadOnly{color:var(--dsw-alias-label-tertiary);font-size:12px;margin:0}
.dtsField{display:flex;flex-direction:column;gap:5px}
.dtsLabelRow{align-items:center;gap:6px;display:flex}
.dtsLabel{font-size:13px;color:var(--dsw-alias-label-primary)}
.dtsBadge{border:.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary);border-radius:4px;padding:1px 6px;font-size:11px;line-height:16px}
.dtsReset{margin-left:auto;background:0 0;border:0;color:var(--dsw-alias-brand-primary);cursor:pointer;font:inherit;font-size:11px;padding:0}
.dtsInput{box-sizing:border-box;width:100%;height:32px;padding:0 10px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.dtsInput:disabled{opacity:.5}
.dtsHint{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;margin:0}
.dtsWarn{color:var(--dsw-alias-state-warn-label);font-size:11px;line-height:16px;margin:0}
.dtsOk{color:var(--dsw-alias-state-success-primary);font-size:11px;line-height:16px;margin:0}
.dtsFail{color:var(--dsw-alias-label-error);font-size:12px;margin:0}
.dtsGroup{border-top:.5px solid var(--dsw-alias-border-l3);padding-top:10px;display:flex;flex-direction:column;gap:10px}
.dtsGroupTitle{color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:500;letter-spacing:.02em;text-transform:uppercase}
.dtsFooter{display:flex;gap:8px;justify-content:flex-end;align-items:center}
.dtsBtn{box-sizing:border-box;height:32px;padding:0 14px;border-radius:16px;border:0;font:inherit;font-size:13px;cursor:pointer}
.dtsSave{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.dtsSave:disabled{opacity:.4;cursor:default}
.dtsDiscard{background:0 0;border:.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-primary)}
.dtsDiscard:disabled{opacity:.4;cursor:default}
.dtsSwitchRow{align-items:center;justify-content:space-between;gap:12px;display:flex}
`

    function ensureStyles() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]')) return
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-typesafe'
      tag.dataset.pluginCss = STYLE_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    function removeStyles() {
      if (typeof document === 'undefined') return
      const tag = document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]')
      if (tag && tag.parentNode) tag.parentNode.removeChild(tag)
    }

    // ── field model ──────────────────────────────────────────────────────────
    // One declaration per editable setting. `path` addresses the settings
    // document; `kind` decides how the value round-trips through the input.
    // Labels and hints are dictionary KEYS, not literals, so the card follows the
    // active language.

    const FIELDS = [
      {
        path: ['baseURL'],
        kind: 'text',
        labelKey: 'fieldEndpoint',
        hintKey: 'fieldEndpointHint',
        placeholder: 'https://api.typesafe.ai',
        group: 'connection',
      },
      {
        path: ['model'],
        kind: 'text',
        labelKey: 'fieldModel',
        hintKey: 'fieldModelHint',
        placeholder: 'jev-latest',
        group: 'connection',
      },
      {
        path: ['inputPricePerMTok'],
        kind: 'number',
        labelKey: 'fieldPrice',
        hintKey: 'fieldPriceHint',
        group: 'connection',
      },
      {
        path: ['guardEnabled'],
        kind: 'bool',
        labelKey: 'fieldGuardEnabled',
        hintKey: 'fieldGuardEnabledHint',
        group: 'guard',
      },
      {
        path: ['guardWarnThreshold'],
        kind: 'number',
        labelKey: 'fieldGuardThreshold',
        hintKey: 'fieldGuardThresholdHint',
        group: 'guard',
      },
      {
        path: ['guardMinChars'],
        kind: 'number',
        labelKey: 'fieldGuardMin',
        hintKey: 'fieldGuardMinHint',
        group: 'guard',
      },
      {
        path: ['guardMaxChars'],
        kind: 'number',
        labelKey: 'fieldGuardMax',
        hintKey: 'fieldGuardMaxHint',
        group: 'guard',
      },
      {
        path: ['promptEnabled'],
        kind: 'bool',
        labelKey: 'fieldPrompt',
        hintKey: 'fieldPromptHint',
        group: 'behaviour',
      },
      {
        path: ['timeoutMs'],
        kind: 'number',
        labelKey: 'fieldTimeout',
        hintKey: 'fieldTimeoutHint',
        group: 'behaviour',
      },
      {
        path: ['maxStateChars'],
        kind: 'number',
        labelKey: 'fieldMaxState',
        hintKey: 'fieldMaxStateHint',
        group: 'behaviour',
      },
    ]

    const GROUPS = [
      { id: 'connection', titleKey: 'groupConnection' },
      { id: 'guard', titleKey: 'groupGuard' },
      { id: 'behaviour', titleKey: 'groupBehaviour' },
    ]

    function isPlainObject(v) {
      return v !== null && typeof v === 'object' && !Array.isArray(v)
    }

    function getAt(obj, path) {
      let cur = obj
      for (const key of path) {
        if (!isPlainObject(cur) || !(key in cur)) return undefined
        cur = cur[key]
      }
      return cur
    }

    function fieldKey(path) {
      return path.join('.')
    }

    function formatValue(field, value) {
      if (value === undefined || value === null) return ''
      if (field.kind === 'bool') return value === true ? 'true' : 'false'
      return String(value)
    }

    /** Parse one draft into the value to store; `undefined` means "invalid, block the save". */
    function parseValue(field, text) {
      if (field.kind === 'bool') return text === true || text === 'true'
      if (field.kind === 'number') {
        const n = Number(text)
        return Number.isFinite(n) ? n : undefined
      }
      return text
    }

    // ── card ─────────────────────────────────────────────────────────────────

    function SettingsCard(props) {
      ensureStyles()
      const scope = props.scope
      const t = props.t
      const [tick, setTick] = React.useState(0)
      const [open, setOpen] = React.useState(false)
      const [staged, setStaged] = React.useState({})
      const [keyDraft, setKeyDraft] = React.useState('')
      const [saving, setSaving] = React.useState(false)
      const [failed, setFailed] = React.useState('')
      const [credential, setCredential] = React.useState({ configured: false, writable: true, checked: false })

      React.useEffect(() => {
        if (!scope || typeof scope.subscribe !== 'function') return undefined
        return scope.subscribe(() => setTick((n) => n + 1))
      }, [scope])

      // Re-render when the application language changes. `t` resolves against the
      // live snapshot at call time, so the strings are already correct on the next
      // render — this subscription is only what triggers that render.
      React.useEffect(() => {
        const locale = props.locale
        if (!locale || typeof locale.subscribe !== 'function') return undefined
        return locale.subscribe(() => setTick((n) => n + 1))
      }, [props.locale])

      const snap = scope && typeof scope.getSnapshot === 'function'
        ? scope.getSnapshot()
        : { status: 'unavailable', value: undefined, base: undefined, user: undefined, revision: undefined, writable: false }

      const available = snap.status === 'ready'
      const writable = !!snap.writable
      const value = snap.value || {}
      const base = snap.base || {}
      const user = snap.user || {}

      /** The credential reference in force, so the card follows a renamed ref. */
      const keyRef = (() => {
        const declared = value.apiKeyEnv
        return typeof declared === 'string' && declared.length > 0 ? declared : DEFAULT_KEY_REF
      })()

      // Read whether a key is stored. The literal is never returned by the
      // settings or credentials layer, so this is the only state available.
      React.useEffect(() => {
        let cancelled = false
        const remote = props.remote
        if (!remote || !remote.credentials) return undefined
        remote.credentials.describe([keyRef]).then((response) => {
          if (cancelled || !response || !response.ok) return
          const view = response.value ? response.value[keyRef] : undefined
          setCredential({
            configured: !!(view && view.configured),
            writable: view ? view.writable !== false : true,
            checked: true,
          })
        }).catch(() => {
          if (!cancelled) setCredential((prev) => ({ ...prev, checked: true }))
        })
        return () => { cancelled = true }
      }, [keyRef, props.remote, tick])

      const plan = []
      for (const field of FIELDS) {
        const draft = staged[fieldKey(field.path)]
        if (!draft) continue
        if (draft.clear) {
          if (getAt(user, field.path) !== undefined) plan.push({ op: 'unset', path: field.path })
          continue
        }
        const parsed = parseValue(field, draft.text)
        if (parsed === undefined) continue // invalid draft; never persisted
        if (formatValue(field, getAt(value, field.path)) === formatValue(field, parsed)) continue
        plan.push({ op: 'set', path: field.path, value: parsed })
      }

      const invalidField = FIELDS.find((field) => {
        const draft = staged[fieldKey(field.path)]
        return draft && !draft.clear && field.kind === 'number' && parseValue(field, draft.text) === undefined
      })
      const keyDirty = keyDraft.trim().length > 0
      const dirty = plan.length > 0 || keyDirty
      const blocked = !dirty || saving || !!invalidField || !writable

      function stage(field, next) {
        setFailed('')
        setStaged((prev) => Object.assign({}, prev, { [fieldKey(field.path)]: next }))
      }

      function discard() {
        if (!dirty && !failed) return
        setStaged({})
        setKeyDraft('')
        setFailed('')
      }

      async function save() {
        if (blocked) return
        setSaving(true)
        setFailed('')
        let ok = true
        let why = ''
        try {
          const remote = props.remote
          if (keyDirty) {
            if (!remote || !remote.credentials) throw new Error(t('credentialsUnavailable'))
            const written = await remote.credentials.set(keyRef, keyDraft.trim())
            // The remote envelope reports a refusal as `{ ok: false, error }`
            // rather than by throwing, so an unchecked await would report a
            // rejected write as a success.
            if (written && written.ok === false) throw new Error(written.error?.message ?? t('credentialWriteRejected'))
            const response = await remote.credentials.describe([keyRef])
            const view = response && response.ok && response.value ? response.value[keyRef] : undefined
            setCredential({ configured: !!(view && view.configured), writable: view ? view.writable !== false : true, checked: true })
          }
          if (plan.length > 0) {
            const response = await remote.settings.mutate(NS, plan, snap.revision)
            // Same envelope contract as above: a conflict or a rejected value
            // arrives as data, not as a rejection.
            if (response && response.ok === false) throw new Error(response.error?.message ?? t('settingsWriteRejected'))
          }
          setStaged({})
          setKeyDraft('')
        } catch (error) {
          ok = false
          why = error && error.message ? error.message : String(error)
        }
        setSaving(false)
        setFailed(ok ? '' : (why || t('settingsWriteRejected')))
      }

      void tick
      if (!available) return null

      const fieldsFor = (groupId) => FIELDS.filter((field) => field.group === groupId).map((field) => {
        const key = fieldKey(field.path)
        const draft = staged[key]
        const current = getAt(value, field.path)
        const stored = getAt(user, field.path) !== undefined
        const overridden = draft ? !draft.clear : stored
        const text = draft ? draft.text : formatValue(field, current)
        const isInvalid = !!draft && !draft.clear && field.kind === 'number' && parseValue(field, draft.text) === undefined
        const inputId = 'plugin-config-typesafe-' + key.replace(/\./g, '-')
        const label = t(field.labelKey)
        const hint = t(field.hintKey)

        if (field.kind === 'bool') {
          const checked = draft ? parseValue(field, draft.text) === true : current === true
          return e('div', { className: 'dtsSwitchRow', key },
            e('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 } },
              e('label', { className: 'dtsLabel', htmlFor: inputId }, label),
              e('p', { className: 'dtsHint' }, hint)),
            e('input', {
              id: inputId,
              type: 'checkbox',
              checked,
              disabled: !writable || saving,
              onChange: (ev) => stage(field, { text: ev.target.checked ? 'true' : 'false', clear: false }),
            }))
        }

        return e('div', { className: 'dtsField', key },
          e('div', { className: 'dtsLabelRow' },
            e('label', { className: 'dtsLabel', htmlFor: inputId }, label),
            overridden ? e('span', { className: 'dtsBadge' }, t('overridden')) : null,
            overridden ? e('button', {
              type: 'button',
              className: 'dtsReset',
              disabled: !writable || saving,
              onClick: () => stage(field, { text: formatValue(field, getAt(base, field.path)), clear: true }),
            }, t('reset')) : null),
          e('input', {
            id: inputId,
            className: 'dtsInput',
            type: field.kind === 'number' ? 'number' : 'text',
            value: text,
            placeholder: field.placeholder || '',
            disabled: !writable || saving,
            onChange: (ev) => stage(field, { text: ev.target.value, clear: false }),
          }),
          isInvalid ? e('p', { className: 'dtsWarn' }, t('invalidNumber')) : null,
          e('p', { className: 'dtsHint' }, hint))
      })

      const body = open ? e('div', { className: 'dtsBody' },
        writable ? null : e('p', { className: 'dtsReadOnly', role: 'status' }, t('readOnly')),

        // The key control. Deliberately first: it is the one field that makes
        // every tool in this plugin work, and the one a new install lacks.
        e('div', { className: 'dtsField' },
          e('div', { className: 'dtsLabelRow' },
            e('label', { className: 'dtsLabel', htmlFor: 'plugin-config-typesafe-key' }, t('apiKey')),
            e('span', { className: 'dtsBadge' }, keyRef),
            e('span', {
              className: 'dtsDot ' + (credential.configured ? 'dtsDotOn' : 'dtsDotOff'),
              title: t(credential.configured ? 'summaryConfigured' : 'summaryMissing'),
            })),
          e('input', {
            id: 'plugin-config-typesafe-key',
            className: 'dtsInput',
            type: 'password',
            value: keyDraft,
            autoComplete: 'off',
            placeholder: t(credential.configured ? 'apiKeyPlaceholderStored' : 'apiKeyPlaceholderEmpty'),
            disabled: !credential.writable || saving,
            onChange: (ev) => { setFailed(''); setKeyDraft(ev.target.value) },
          }),
          credential.configured
            ? e('p', { className: 'dtsOk' }, t('apiKeyConfigured'))
            : e('p', { className: 'dtsWarn' }, t('apiKeyMissing')),
          credential.writable ? null : e('p', { className: 'dtsWarn' }, t('apiKeyReadOnly')),
          e('p', { className: 'dtsHint' }, t('apiKeyStorageHint')))

        , ...GROUPS.map((group) => e('div', { className: 'dtsGroup', key: group.id },
          e('span', { className: 'dtsGroupTitle' }, t(group.titleKey)),
          ...fieldsFor(group.id))),

        e('div', { className: 'dtsFooter' },
          failed ? e('p', { className: 'dtsFail', role: 'status' }, t('saveFailed', { message: failed })) : null,
          e('button', { type: 'button', className: 'dtsBtn dtsDiscard', disabled: !dirty || saving, onClick: discard }, t('discard')),
          e('button', { type: 'button', className: 'dtsBtn dtsSave', disabled: blocked, onClick: save },
            saving ? t('saving') : (invalidField ? t('fixInvalid') : t('save'))))) : null

      return e('li', { className: 'dtsCard' },
        e('button', {
          type: 'button',
          className: 'dtsHeader',
          'aria-expanded': open,
          onClick: () => setOpen(!open),
        },
        e('span', { className: 'dtsDot ' + (credential.configured ? 'dtsDotOn' : 'dtsDotOff') }),
        e('span', { className: 'dtsHeadText' },
          // The product name is a brand, not copy: it stays untranslated so the
          // card is findable by the same title in every language.
          e('span', { className: 'dtsName' }, 'TypeSafe (Jev)'),
          e('span', { className: 'dtsDescription' }, t(credential.configured ? 'summaryConfigured' : 'summaryMissing'))),
        e('span', { className: 'dtsChevron' }, open ? '▲' : '▼')),
        body)
    }

    // ── plugin ───────────────────────────────────────────────────────────────

    function apply(ctx) {
      if (typeof document === 'undefined') return

      // Register both shipped languages, then bind this namespace. Registering
      // the dictionary is what lets the card follow the application language
      // instead of hard-coding one; without it every `t()` would return the key.
      ctx.effect(() => ctx.locale.register(NS, DICTS), 'dsh-typesafe: dictionaries')
      const t = ctx.locale.bind(NS)

      const scope = ctx.settingsScope.bind({ namespace: NS })
      const remote = ctx.get('remote')

      const disposeSlot = ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
        name: 'settings.plugin.item',
        key: NS,
        label: 'TypeSafe (Jev)',
      }, function TypeSafeCard() {
        return e(SettingsCard, { scope, remote, t, locale: ctx.locale })
      }))

      ctx.effect(() => () => removeStyles(), 'dsh-typesafe: card styles')

      return disposeSlot
    }

    exports.apply = apply
    // `locale` is required: without it the card cannot render its copy. The
    // remote sub-namespaces are separate injectable services rather than
    // properties that appear on `remote` at an arbitrary time, so they are
    // declared too — the same contract the official settings-plugins package
    // uses. Declaring only `remote` would let apply run before they mount, and
    // the card would then render with a dead Save button.
    exports.inject = ['slots', 'locale', 'settingsScope', 'remote', 'remote.settings', 'remote.credentials']
    return module.exports
  },
})
