/**
 * The Jev wire client: one HTTP call into TypeSafe's System One endpoint.
 *
 * Deliberately dependency-free and transport-only. It knows the request and
 * response shapes documented at https://docs.typesafe.ai/api and nothing about
 * the harness: no settings, no credentials, no tools. Callers supply a resolved
 * apiKey and section; this module turns that into answers and a cost figure.
 *
 * Two response facts are load-bearing downstream and are normalized here so no
 * caller has to remember them:
 *   - `usage.output_tokens` is reported but NOT billed (output is free).
 *   - `confidence` exists on choice/score answers only; a noul answer is a bare
 *     probability and has no separate confidence.
 * @module dsh-typesafe/jev
 */

/** Stable error codes so a caller can branch without matching message text. */
export const JEV_ERROR_CODES = Object.freeze({
  NO_KEY: 'TYPESAFE_NO_API_KEY',
  HTTP: 'TYPESAFE_HTTP_ERROR',
  TIMEOUT: 'TYPESAFE_TIMEOUT',
  ABORTED: 'TYPESAFE_ABORTED',
  BAD_RESPONSE: 'TYPESAFE_BAD_RESPONSE',
  BAD_REQUEST: 'TYPESAFE_BAD_REQUEST',
})

/** An error carrying a stable `code`, so callers never parse the message. */
export class JevError extends Error {
  /**
   * @param {string} message - human-readable, actionable message.
   * @param {string} code - one of {@link JEV_ERROR_CODES}.
   * @param {{cause?: unknown}} [options] - original failure, when there was one.
   */
  constructor(message, code, options) {
    super(message, options)
    this.name = 'JevError'
    this.code = code
  }
}

/** True when a value is a non-empty string. */
function hasText(value) {
  return typeof value === 'string' && value.length > 0
}

/**
 * Validate one question object against the documented shape before spending a
 * request on it. Catching this locally turns a 422 into an immediate, precise
 * message that names the offending question key.
 * @param {string} id - the question key the caller chose.
 * @param {unknown} question - the candidate question.
 * @throws {JevError} with code `TYPESAFE_BAD_REQUEST`.
 */
function assertQuestion(id, question) {
  if (typeof question !== 'object' || question === null || Array.isArray(question)) {
    throw new JevError(`question "${id}" must be an object`, JEV_ERROR_CODES.BAD_REQUEST)
  }
  const type = question.type
  if (type !== 'noul' && type !== 'choice' && type !== 'score') {
    throw new JevError(`question "${id}" has type ${JSON.stringify(type)}; expected "noul", "choice", or "score"`, JEV_ERROR_CODES.BAD_REQUEST)
  }
  if (question.instructions === undefined) {
    throw new JevError(`question "${id}" is missing "instructions"`, JEV_ERROR_CODES.BAD_REQUEST)
  }
  if (type === 'choice') {
    const criteria = question.criteria
    if (typeof criteria !== 'object' || criteria === null || Array.isArray(criteria)) {
      throw new JevError(`choice question "${id}" needs a "criteria" object mapping each option to its description`, JEV_ERROR_CODES.BAD_REQUEST)
    }
    const options = Object.keys(criteria)
    if (options.length === 0) {
      throw new JevError(`choice question "${id}" has no options in "criteria"`, JEV_ERROR_CODES.BAD_REQUEST)
    }
    if (options.length > 255) {
      throw new JevError(`choice question "${id}" has ${options.length} options; the API accepts at most 255`, JEV_ERROR_CODES.BAD_REQUEST)
    }
  }
  if (type === 'score') {
    const criteria = question.criteria
    if (!Array.isArray(criteria)) {
      throw new JevError(`score question "${id}" needs a "criteria" array of level descriptions`, JEV_ERROR_CODES.BAD_REQUEST)
    }
    if (criteria.length < 2) {
      throw new JevError(`score question "${id}" needs at least 2 levels (got ${criteria.length})`, JEV_ERROR_CODES.BAD_REQUEST)
    }
    if (criteria.length > 10) {
      throw new JevError(`score question "${id}" has ${criteria.length} levels; the API accepts at most 10`, JEV_ERROR_CODES.BAD_REQUEST)
    }
  }
}

/**
 * Build the request body. Throws before any network work when the shape is
 * wrong, so a malformed call costs nothing.
 * @param {{state: unknown, model: string, questions: Record<string, unknown>}} input - the call.
 * @returns {string} the JSON body.
 * @throws {JevError} with code `TYPESAFE_BAD_REQUEST`.
 */
export function buildRequestBody({ state, model, questions }) {
  if (state === undefined || state === null) {
    throw new JevError('"state" is required', JEV_ERROR_CODES.BAD_REQUEST)
  }
  if (typeof state === 'object' && !Array.isArray(state) && Object.keys(state).length === 0) {
    throw new JevError('"state" is an empty object; send the text or record to evaluate', JEV_ERROR_CODES.BAD_REQUEST)
  }
  if (Array.isArray(state) && state.length === 0) {
    throw new JevError('"state" is an empty array; send the text or record to evaluate', JEV_ERROR_CODES.BAD_REQUEST)
  }
  if (typeof state !== 'object' || state === null) {
    if (typeof state !== 'string') {
      throw new JevError(`"state" must be a string, object, or array (got ${typeof state})`, JEV_ERROR_CODES.BAD_REQUEST)
    }
    if (state.trim().length === 0) {
      throw new JevError('"state" is blank', JEV_ERROR_CODES.BAD_REQUEST)
    }
  }
  if (typeof questions !== 'object' || questions === null || Array.isArray(questions)) {
    throw new JevError('"questions" must be an object mapping your chosen ids to question objects', JEV_ERROR_CODES.BAD_REQUEST)
  }
  const ids = Object.keys(questions)
  if (ids.length === 0) {
    throw new JevError('"questions" is empty; ask at least one question', JEV_ERROR_CODES.BAD_REQUEST)
  }
  for (const id of ids) assertQuestion(id, questions[id])
  return JSON.stringify({ state, model, questions })
}

/**
 * Whether a resolved answer reports a confidence. `choice` and `score` carry
 * one; a `noul` is a bare probability, so reading `.confidence` off it yields
 * undefined rather than a fabricated number.
 * @param {unknown} answer - one entry from the response `answers` map.
 * @returns {number|undefined} the confidence in 0..1, when the answer has one.
 */
export function confidenceOf(answer) {
  if (typeof answer !== 'object' || answer === null) return undefined
  return typeof answer.confidence === 'number' ? answer.confidence : undefined
}

/**
 * Priced cost of one call. Output tokens are reported by the API but not
 * charged, so only input tokens enter the figure.
 * @param {unknown} usage - the response `usage` object.
 * @param {number} inputPricePerMTok - USD per million input tokens.
 * @returns {{inputTokens: number, outputTokens: number, costUsd: number}} the accounting.
 */
export function costOf(usage, inputPricePerMTok) {
  const record = typeof usage === 'object' && usage !== null ? usage : {}
  const inputTokens = Number.isFinite(record.input_tokens) ? record.input_tokens : 0
  const outputTokens = Number.isFinite(record.output_tokens) ? record.output_tokens : 0
  return {
    inputTokens,
    outputTokens,
    costUsd: (inputTokens / 1_000_000) * inputPricePerMTok,
  }
}

/**
 * Evaluate questions against a state.
 *
 * @param {object} options - the call.
 * @param {string} options.apiKey - resolved credential; a blank value throws `TYPESAFE_NO_API_KEY`.
 * @param {string} options.baseURL - API origin, no trailing slash.
 * @param {string} options.model - model alias or versioned id.
 * @param {unknown} options.state - text or structured record to evaluate.
 * @param {Record<string, unknown>} options.questions - typed questions keyed by your ids.
 * @param {number} [options.timeoutMs] - per-request timeout.
 * @param {AbortSignal} [options.signal] - caller cancellation.
 * @param {number} [options.inputPricePerMTok] - for the returned cost figure.
 * @returns {Promise<{model: string, answers: Record<string, unknown>, usage: object, inputTokens: number, outputTokens: number, costUsd: number, elapsedMs: number}>} the answers and accounting.
 * @throws {JevError} on a missing key, timeout, transport failure, or non-2xx status.
 */
export async function evaluate({
  apiKey,
  baseURL,
  model,
  state,
  questions,
  timeoutMs = 30000,
  signal,
  inputPricePerMTok = 0,
}) {
  if (!hasText(apiKey)) {
    throw new JevError(
      'No TypeSafe API key is configured. Open Settings > Plugins > Plugin configuration > TypeSafe and paste a key, or set TYPESAFE_API_KEY in the launching environment.',
      JEV_ERROR_CODES.NO_KEY,
    )
  }
  const body = buildRequestBody({ state, model, questions })
  const endpoint = `${String(baseURL).replace(/\/+$/u, '')}/v1/systemone`

  // One timeout budget for the whole attempt, fused with the caller's signal so
  // either can cancel. `AbortSignal.any` would nest relays on repeated calls.
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new JevError(`TypeSafe request exceeded ${timeoutMs}ms`, JEV_ERROR_CODES.TIMEOUT))
  }, timeoutMs)
  const onCallerAbort = () => {
    controller.abort(new JevError('TypeSafe request aborted by the caller', JEV_ERROR_CODES.ABORTED))
  }
  if (signal !== undefined) {
    if (signal.aborted) onCallerAbort()
    else signal.addEventListener('abort', onCallerAbort, { once: true })
  }

  const startedAt = Date.now()
  try {
    let response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body,
        signal: controller.signal,
      })
    } catch (error) {
      const reason = controller.signal.reason
      if (reason instanceof JevError) throw reason
      throw new JevError(`TypeSafe request failed: ${String(error)}`, JEV_ERROR_CODES.HTTP, { cause: error })
    }

    if (!response.ok) {
      // The API documents a JSON body naming the offending field on 422, and
      // that detail is the single most useful thing to hand back.
      let detail = ''
      try {
        const parsed = await response.json()
        const message = typeof parsed?.error === 'string' ? parsed.error : parsed?.error?.message ?? parsed?.message
        if (hasText(message)) detail = `: ${message}`
      } catch {
        // A non-JSON error body is not itself an error worth reporting.
      }
      if (response.status === 401) {
        throw new JevError(
          `TypeSafe rejected the API key (HTTP 401)${detail}. Check the key in Settings > Plugins > Plugin configuration > TypeSafe.`,
          JEV_ERROR_CODES.HTTP,
        )
      }
      if (response.status === 429) {
        throw new JevError(
          `TypeSafe rate limit exceeded (HTTP 429)${detail}. Jev allows 250k tokens/s and 1,200 requests/min by default; retry shortly.`,
          JEV_ERROR_CODES.HTTP,
        )
      }
      throw new JevError(`TypeSafe API error (HTTP ${response.status})${detail}`, JEV_ERROR_CODES.HTTP)
    }

    let parsed
    try {
      parsed = await response.json()
    } catch (error) {
      throw new JevError('TypeSafe returned an unprocessable response body', JEV_ERROR_CODES.BAD_RESPONSE, { cause: error })
    }
    if (typeof parsed !== 'object' || parsed === null || typeof parsed.answers !== 'object' || parsed.answers === null) {
      throw new JevError('TypeSafe response carried no "answers" map', JEV_ERROR_CODES.BAD_RESPONSE)
    }

    const cost = costOf(parsed.usage, inputPricePerMTok)
    return {
      model: hasText(parsed.model) ? parsed.model : model,
      answers: parsed.answers,
      usage: typeof parsed.usage === 'object' && parsed.usage !== null ? parsed.usage : {},
      ...cost,
      elapsedMs: Date.now() - startedAt,
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onCallerAbort)
  }
}
