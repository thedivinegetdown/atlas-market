import { createHash } from 'node:crypto'
import { exitPolicyEvaluators } from './exitPolicyEvaluator.js'

export const EXIT_EVIDENCE_VERSION = 'pa4-session-chronology-v1'
export const AUTHORITATIVE_CHRONOLOGY_UNAVAILABLE = 'AUTHORITATIVE_CHRONOLOGY_UNAVAILABLE'
const MINUTE = 60_000
const receipts = new WeakSet()
const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value
const hash = (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(stable(value))).digest('hex')
const freeze = (value) => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
const requireEvidence = (condition, reason) => { if (!condition) throw new Error(reason) }
const instant = (value) => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN
const iso = (value) => new Date(value).toISOString()
const unavailable = (reason) => freeze({ status: AUTHORITATIVE_CHRONOLOGY_UNAVAILABLE, reason })
const localDate = (value, timezone) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))

function bindingFor({ scope, position, entry, policy }) {
  const binding = {
    organizationId: scope?.organizationId, teamWorkspaceId: scope?.teamWorkspaceId ?? '',
    accountId: scope?.accountId, userId: scope?.userId, accountRecordId: position?.accountRecordId,
    positionId: position?.positionId, positionRevision: position?.revision,
    quantity: position?.quantity, side: position?.side, symbol: position?.symbol,
    entryExecutionId: entry?.executionId, entryExecutionAt: entry?.executedAt,
    entryFillPrice: entry?.fillPrice, entryTimeBasis: entry?.entryChronology?.timeBasis,
    evaluationFingerprint: entry?.evaluationEvidenceFingerprint,
    intentFingerprint: entry?.executionIntentFingerprint, frozenPolicyFingerprint: policy?.fingerprint,
    frozenPolicyDefinitionFingerprint: policy?.definitionFingerprint,
  }
  requireEvidence(Object.entries(binding).every(([key, value]) => key === 'teamWorkspaceId' || (value !== undefined && value !== null && value !== '')), 'incomplete_ledger_binding')
  requireEvidence(Number.isInteger(binding.positionRevision) && binding.positionRevision >= 0 && Number.isFinite(instant(binding.entryExecutionAt)), 'invalid_ledger_binding')
  requireEvidence(entry.positionId === position.positionId && entry.executionIntentFingerprint === position.originatingIntentFingerprint
    && entry.exitPolicy?.fingerprint === policy.fingerprint && policy.positionSide === position.side
    && entry.entryChronology?.version === 'paper-entry-ledger-clock-v1'
    && entry.entryChronology?.timeBasis === 'execution_created_at', 'entry_binding_mismatch')
  return binding
}

// An in-process receipt is never accepted from JSON, HTTP, or a persisted replay.
export function isExitEvidenceFor(evidence, context) {
  try { return receipts.has(evidence) && evidence.manifest.bindingHash === hash(bindingFor(context)) } catch { return false }
}

export function isServerExitEvidence(evidence, position) {
  return receipts.has(evidence) && evidence.manifest.binding.positionId === position?.positionId
    && evidence.manifest.binding.positionRevision === position?.revision
    && evidence.manifest.binding.frozenPolicyFingerprint === position?.exitPolicy?.fingerprint
}

/** Server composition only. No production provider is registered or qualified here.
 * source.retrieve(request) supplies the documented neutral evidence envelope.
 * qualification is independently supplied by server composition, never by the source response.
 */
export function createExitEvidenceService({ source = null, qualification = null, clock = () => new Date().toISOString() } = {}) {
  // Snapshot qualification: changes require a newly composed service.
  const qualified = qualification ? freeze(JSON.parse(JSON.stringify(qualification))) : null
  return Object.freeze({
    async getExitEvidence(context) {
      try {
        const asOf = clock()
        const now = instant(asOf)
        requireEvidence(source && typeof source.retrieve === 'function' && qualified, 'provider_not_qualified')
        requireEvidence(['GENUINE', 'SYNTHETIC'].includes(qualified.evidenceClass) && qualified.reference
          && qualified.provider === source.provider && qualified.source === source.id
          && instant(qualified.validFrom) <= now && instant(qualified.validUntil) >= now
          && ['finalMinutes', 'completePagination', 'completeCalendar', 'sessionOpenClose', 'corporateActions', 'retainedContent'].every((key) => qualified.capabilities?.[key] === true), 'provider_not_qualified')
        const binding = bindingFor(context)
        const policy = context.policy
        const evaluate = exitPolicyEvaluators[policy.version]
        requireEvidence(evaluate && Number.isInteger(policy.maximumHoldingSessions) && policy.maximumHoldingSessions > 0, 'unsupported_frozen_policy')
        const entryAt = instant(binding.entryExecutionAt)
        requireEvidence(entryAt <= now, 'invalid_entry_time')
        const request = freeze({ version: EXIT_EVIDENCE_VERSION, symbol: binding.symbol, entryExecutionId: binding.entryExecutionId,
          from: binding.entryExecutionAt, through: asOf, intervalMs: MINUTE, includeContainingEntryMinute: true,
          sessionType: 'regular', priceBasis: 'UNADJUSTED' })
        // Adapter owns existing provider pacing/retries. No polling or fallback quotes here.
        const data = await source.retrieve(request)
        const retrievedAt = clock()
        requireEvidence(instant(retrievedAt) >= now && instant(retrievedAt) <= instant(qualified.validUntil), 'invalid_retrieval_time')
        requireEvidence(data?.provider === qualified.provider && data?.source === qualified.source
          && data?.evidenceClass === qualified.evidenceClass && hash(data.request) === hash(request), 'source_binding_mismatch')
        const instrument = data.instrument
        requireEvidence(instrument?.symbol === binding.symbol && /^[A-Z0-9]{4}$/.test(instrument.mic ?? '') && instrument.timezone, 'instrument_identity_incomplete')
        requireEvidence(qualified.instruments?.some((item) => item.symbol === instrument.symbol && item.mic === instrument.mic
          && item.timezone === instrument.timezone), 'instrument_not_qualified')
        const startDate = localDate(entryAt, instrument.timezone), endDate = localDate(now, instrument.timezone)
        requireEvidence(data.quality?.finality === 'FINAL' && data.quality?.corrections === 'RESOLVED'
          && data.quality?.completeness === 'COMPLETE' && data.quality?.paginationComplete === true
          && data.quality?.snapshotId && instant(data.quality.finalAsOf) >= now
          && instant(data.quality.finalAsOf) <= instant(retrievedAt), 'provider_finality_or_completeness_unknown')
        const actions = data.corporateActions
        requireEvidence(actions?.status === 'NO_ACTIONS' && actions?.basis === 'UNADJUSTED'
          && actions?.entryExecutionId === binding.entryExecutionId && instant(actions.from) <= entryAt
          && instant(actions.through) >= now && actions.reference, 'corporate_action_ambiguity')
        const calendar = data.calendar
        requireEvidence(calendar?.id && calendar?.revision && calendar?.complete === true
          && calendar?.mic === instrument.mic && calendar?.timezone === instrument.timezone
          && Array.isArray(calendar.days) && calendar.days.length > 0, 'incomplete_calendar')
        const sessions = []
        let expectedDate = startDate
        for (const day of calendar.days) {
          requireEvidence(day.date === expectedDate && Array.isArray(day.sessions) && day.sessions.length <= 1, 'incomplete_calendar')
          for (const session of day.sessions) {
            const open = instant(session.openAt), close = instant(session.closeAt)
            requireEvidence(session.id && Number.isFinite(open) && close > open && open % MINUTE === 0 && close % MINUTE === 0
              && localDate(open, instrument.timezone) === day.date && localDate(close - 1, instrument.timezone) === day.date, 'invalid_session')
            if (open <= now) sessions.push({ ...session, open, close })
          }
          expectedDate = iso(Date.parse(`${day.date}T00:00:00Z`) + 86_400_000).slice(0, 10)
        }
        requireEvidence(calendar.days.at(-1).date === endDate && sessions.length > 0
          && sessions[0].open <= entryAt && entryAt < sessions[0].close
          && sessions.every((session, index) => (!index || session.open > sessions[index - 1].close)
            && session.close <= now)
          && new Set(sessions.map((session) => session.id)).size === sessions.length, 'incomplete_session_or_calendar')
        requireEvidence(Array.isArray(data.pages) && data.pages.length > 0, 'missing_raw_pages')
        const pageHashes = [], minutes = []
        for (const page of data.pages) {
          requireEvidence(page.id && page.archiveReference && typeof page.rawContent === 'string'
            && page.rawContent.length > 0 && typeof page.content === 'string', 'missing_retained_content')
          const parsed = JSON.parse(page.content)
          requireEvidence(Array.isArray(parsed.minutes), 'invalid_page_content')
          pageHashes.push({ id: page.id, archiveReference: page.archiveReference,
            sha256: hash(page.rawContent), normalizedContentHash: hash(page.content) })
          minutes.push(...parsed.minutes)
        }
        requireEvidence(new Set(pageHashes.map((page) => page.id)).size === pageHashes.length, 'duplicate_page')
        const indexed = new Map()
        for (const minute of minutes) {
          const time = instant(minute.startAt)
          const values = [minute.open, minute.high, minute.low, minute.close]
          requireEvidence(Number.isFinite(time) && time % MINUTE === 0 && instant(minute.endAt) === time + MINUTE
            && !indexed.has(time) && values.every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)
            && minute.high >= Math.max(minute.open, minute.close) && minute.low <= Math.min(minute.open, minute.close)
            && minute.high >= minute.low, 'invalid_or_duplicate_minute')
          indexed.set(time, minute)
        }
        const sessionBars = []
        requireEvidence(Array.isArray(data.sessionPrices) && data.sessionPrices.length === sessions.length
          && new Set(data.sessionPrices.map((price) => price.sessionId)).size === sessions.length, 'unverified_session_prices')
        let used = 0
        for (const [index, session] of sessions.entries()) {
          const first = index === 0 ? Math.floor(entryAt / MINUTE) * MINUTE : session.open
          const bars = []
          for (let time = first; time < session.close; time += MINUTE) {
            const minute = indexed.get(time)
            requireEvidence(minute && minute.sessionId === session.id, 'missing_interval')
            used += 1
            // A minute containing entry may be skipped only if its complete range
            // proves neither threshold was touched, including at the exact minute boundary.
            if (index === 0 && time === first) {
              const touched = policy.positionSide === 'long'
                ? minute.low <= policy.initialStop || minute.high >= policy.profitTarget
                : minute.high >= policy.initialStop || minute.low <= policy.profitTarget
              requireEvidence(!touched, 'ambiguous_entry_minute')
              continue
            }
            bars.push(minute)
          }
          requireEvidence(bars.length > 0, 'insufficient_post_entry_evidence')
          const prices = data.sessionPrices.find((price) => price.sessionId === session.id)
          requireEvidence(prices?.status === 'VERIFIED_FINAL' && prices.reference && prices.close === bars.at(-1).close
            && typeof prices.close === 'number' && (index === 0 || prices.open === bars[0].open), 'unverified_session_prices')
          // The entry-session open is a neutral policy anchor, never a fake gap.
          // All subsequent opens are the actual first minute of a verified session.
          const open = index === 0 ? policy.entryPrice : bars[0].open
          const bar = { open, high: Math.max(open, ...bars.map((bar) => bar.high)), low: Math.min(open, ...bars.map((bar) => bar.low)),
            close: bars.at(-1).close, observedAt: session.closeAt, freshness: 'FRESH' }
          sessionBars.push({ sessionId: session.id, sessionNumber: index + 1, openAt: session.openAt, closeAt: session.closeAt,
            openBasis: index === 0 ? 'ENTRY_POLICY_ANCHOR_NO_GAP' : 'VERIFIED_SESSION_OPEN', bar })
        }
        requireEvidence(used === minutes.length, 'unexpected_interval')
        let selected = null
        for (const session of sessionBars) {
          const decision = evaluate({ policy, bar: session.bar, sessionsHeld: session.sessionNumber })
          requireEvidence(['HOLD', 'EXIT_FULL'].includes(decision.action), 'invalid_frozen_policy')
          if (decision.action === 'EXIT_FULL') { selected = { ...session, decision }; break }
        }
        const core = {
          version: EXIT_EVIDENCE_VERSION, evaluatorVersion: `${EXIT_EVIDENCE_VERSION}/${policy.version}`,
          binding, bindingHash: hash(binding), instrument, provider: data.provider, source: data.source,
          evidenceClass: qualified.evidenceClass, qualificationReference: qualified.reference, qualificationHash: hash(qualified),
          retrievalParameters: request, retrievedAt, quality: data.quality, rawPages: pageHashes,
          contentHash: hash(data), calendar, corporateActions: actions, sessionPrices: data.sessionPrices, sessionBars,
          selected: selected ?? { decision: { action: 'HOLD', reason: 'no_exit_condition_met' } },
        }
        const manifest = freeze({ ...core, manifestHash: hash(core) })
        const result = freeze({ status: 'AVAILABLE', manifest, decision: manifest.selected.decision,
          policyBar: selected?.bar ?? null, sessionsHeld: selected?.sessionNumber ?? sessionBars.length })
        receipts.add(result)
        return result
      } catch (error) {
        // No provider error text (URLs, credentials, raw payloads) crosses this boundary.
        const known = new Set(['provider_not_qualified', 'incomplete_ledger_binding', 'invalid_ledger_binding', 'entry_binding_mismatch', 'unsupported_frozen_policy', 'invalid_entry_time', 'invalid_retrieval_time', 'source_binding_mismatch', 'instrument_identity_incomplete', 'instrument_not_qualified', 'provider_finality_or_completeness_unknown', 'corporate_action_ambiguity', 'incomplete_calendar', 'invalid_session', 'incomplete_session_or_calendar', 'missing_raw_pages', 'missing_retained_content', 'invalid_page_content', 'duplicate_page', 'invalid_or_duplicate_minute', 'missing_interval', 'ambiguous_entry_minute', 'insufficient_post_entry_evidence', 'unverified_session_prices', 'unexpected_interval', 'invalid_frozen_policy'])
        return unavailable(known.has(error?.message) ? error.message : 'evidence_retrieval_failed')
      }
    },
  })
}
