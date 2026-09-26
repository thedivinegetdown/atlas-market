import { describe, expect, it, vi } from 'vitest'
import { createExitEvidenceService, isExitEvidenceFor, AUTHORITATIVE_CHRONOLOGY_UNAVAILABLE } from '../lib/opportunities/paperExit/exitEvidence.js'
import { simulatePaperPositionExit } from '../lib/opportunities/paperExit/paperExitEngine.js'
import { exitEvidenceFixture } from './helpers/exitEvidenceFixtures.js'

async function evidence(options = {}) {
  const fixture = exitEvidenceFixture(options)
  return { ...fixture, result: await createExitEvidenceService(fixture).getExitEvidence(fixture.context) }
}

describe('PA.4 authoritative chronology (controlled evidence only)', () => {
  it.each([
    ['long', { low: 97 }, 'initial_stop', 98],
    ['long', { high: 105 }, 'profit_target', 104],
    ['long', { low: 97, high: 105 }, 'same_bar_stop_target_stop_first', 98],
    ['short', { high: 103 }, 'initial_stop', 102],
    ['short', { low: 95 }, 'profit_target', 96],
    ['short', { high: 103, low: 95 }, 'same_bar_stop_target_stop_first', 102],
  ])('reconstructs %s session for %j', async (side, bar, reason, price) => {
    const { result } = await evidence({ side, mutate: (_data, minutes) => Object.assign(minutes[2], bar) })
    expect(result).toMatchObject({ status: 'AVAILABLE', sessionsHeld: 1, decision: { action: 'EXIT_FULL', reason, exitPrice: price } })
    expect(result.manifest.sessionBars).toHaveLength(1)
  })

  it('uses session stop-first even when the target minute precedes the stop minute', async () => {
    const { result } = await evidence({ mutate: (_data, minutes) => { minutes[1].high = 105; minutes[3].low = 97 } })
    expect(result.decision).toMatchObject({ reason: 'same_bar_stop_target_stop_first', exitPrice: 98 })
  })

  it('selects the first triggering session, not a later stop or a current quote', async () => {
    const { result, context, now } = await evidence({ count: 2, mutate: (_data, minutes) => { minutes[2].high = 105; minutes[6].low = 97 } })
    expect(result.decision).toMatchObject({ reason: 'profit_target', exitPrice: 104 })
    const simulated = simulatePaperPositionExit({ position: { ...context.position, averagePrice: 100 }, account: { cash: 99000, equity: 100000 }, quantity: 10,
      quote: { price: 90, updatedAt: now }, exitEvidence: result }, { now })
    expect(simulated).toMatchObject({ status: 'POSITION_CLOSED', exitPlan: { referencePrice: 104, simulatedExitPrice: 103.95, evidenceTimestamp: '2026-08-13T12:04:00.000Z' } })
    expect(simulated.exitEvidenceManifest).toBe(result.manifest)
  })

  it.each([
    ['long', { open: 95, high: 96, low: 94, close: 95 }, 'stop_gap', 95],
    ['long', { open: 106, high: 108, low: 105, close: 107 }, 'target_gap', 104],
    ['short', { open: 105, high: 106, low: 104, close: 105 }, 'stop_gap', 105],
    ['short', { open: 94, high: 95, low: 93, close: 94 }, 'target_gap', 96],
  ])('uses genuine later-session opening gap for %s', async (side, bar, reason, exitPrice) => {
    const { result } = await evidence({ count: 2, side, mutate: (_data, minutes) => Object.assign(minutes[4], bar) })
    expect(result).toMatchObject({ sessionsHeld: 2, decision: { reason, exitPrice } })
  })

  it('does not turn a post-entry minute opening discontinuity into a session gap', async () => {
    const { result } = await evidence({ mutate: (_data, minutes) => Object.assign(minutes[1], { open: 95, high: 96, low: 94, close: 95 }) })
    expect(result.decision).toMatchObject({ reason: 'initial_stop', exitPrice: 98 })
  })

  it('uses verified session-20 close, counts entry session, and never extrapolates a hold', async () => {
    const { result } = await evidence({ count: 21, mutate: (_data, minutes) => { minutes[79].close = 101; minutes[83].close = 99 } })
    expect(result).toMatchObject({ sessionsHeld: 20, decision: { reason: 'maximum_holding_period', exitPrice: 101 } })
    expect((await evidence({ count: 19 })).result.decision.action).toBe('HOLD')
  })

  it('requires the session-20 closing interval and an independently verified matching close', async () => {
    expect((await evidence({ count: 20, mutate: (_data, minutes) => minutes.pop() })).result.reason).toBe('missing_interval')
    const fixture = exitEvidenceFixture({ count: 20 })
    const retrieve = fixture.source.retrieve
    fixture.source.retrieve = async (request) => {
      const data = await retrieve(request)
      data.sessionPrices[19].close = 103
      return data
    }
    expect((await createExitEvidenceService(fixture).getExitEvidence(fixture.context)).reason).toBe('unverified_session_prices')
  })

  it('counts calendar sessions rather than elapsed dates', async () => {
    const fixture = exitEvidenceFixture({ count: 3 })
    const retrieve = fixture.source.retrieve
    fixture.source.retrieve = async (request) => {
      const data = await retrieve(request)
      data.calendar.days[1].sessions = []
      data.sessionPrices.splice(1, 1)
      const minutes = JSON.parse(data.pages[0].content).minutes.filter((minute) => minute.sessionId !== 'fixture-session-2')
      data.pages[0].content = JSON.stringify({ minutes })
      data.pages[0].rawContent = JSON.stringify({ fixtureMinutes: minutes })
      return data
    }
    const result = await createExitEvidenceService(fixture).getExitEvidence(fixture.context)
    expect(result).toMatchObject({ status: 'AVAILABLE', sessionsHeld: 2, decision: { action: 'HOLD' } })
  })

  it.each([
    ['entry-minute ambiguity', (_data, minutes) => { minutes[0].low = 97 }, 'ambiguous_entry_minute'],
    ['missing interval', (_data, minutes) => { minutes.splice(2, 1) }, 'missing_interval'],
    ['duplicate interval', (_data, minutes) => { minutes.push(minutes[2]) }, 'invalid_or_duplicate_minute'],
    ['incomplete calendar', (data) => { data.calendar.complete = false }, 'incomplete_calendar'],
    ['missing calendar day', (data) => { data.calendar.days.shift() }, 'incomplete_calendar'],
    ['incomplete session', (data) => { data.calendar.days.at(-1).sessions[0].closeAt = data.request.through.replace('12:05', '12:06') }, 'incomplete_session_or_calendar'],
    ['corporate action', (data) => { data.corporateActions.status = 'UNKNOWN' }, 'corporate_action_ambiguity'],
    ['provider finality', (data) => { data.quality.finality = 'UNKNOWN' }, 'provider_finality_or_completeness_unknown'],
    ['correction pending', (data) => { data.quality.corrections = 'PENDING' }, 'provider_finality_or_completeness_unknown'],
    ['pagination incomplete', (data) => { data.quality.paginationComplete = false }, 'provider_finality_or_completeness_unknown'],
    ['wrong source', (data) => { data.source = 'other' }, 'source_binding_mismatch'],
    ['wrong symbol', (data) => { data.instrument.symbol = 'MSFT' }, 'instrument_identity_incomplete'],
    ['invalid OHLC', (_data, minutes) => { minutes[2].low = null }, 'invalid_or_duplicate_minute'],
    ['unverified session close', (data) => { data.sessionPrices = [] }, 'unverified_session_prices'],
    ['wrong MIC', (data) => { data.instrument.mic = 'XNYS' }, 'instrument_not_qualified'],
  ])('fails closed for %s', async (_label, mutate, reason) => {
    expect((await evidence({ count: 2, mutate })).result).toEqual({ status: AUTHORITATIVE_CHRONOLOGY_UNAVAILABLE, reason })
  })

  it('keeps unqualified default and expired qualification unavailable without retrieval', async () => {
    expect(await createExitEvidenceService().getExitEvidence({})).toEqual({ status: AUTHORITATIVE_CHRONOLOGY_UNAVAILABLE, reason: 'provider_not_qualified' })
    const fixture = exitEvidenceFixture()
    fixture.qualification.validUntil = '2020-01-01T00:00:00Z'
    fixture.source.retrieve = vi.fn()
    expect((await createExitEvidenceService(fixture).getExitEvidence(fixture.context)).status).toBe(AUTHORITATIVE_CHRONOLOGY_UNAVAILABLE)
    expect(fixture.source.retrieve).not.toHaveBeenCalled()
  })

  it('binds and freezes provenance, hashes retained raw content, and rejects replay or changed scope/revision', async () => {
    const { result, context } = await evidence({ mutate: (_data, minutes) => { minutes[2].low = 97 } })
    expect(isExitEvidenceFor(result, context)).toBe(true)
    expect(isExitEvidenceFor(structuredClone(result), context)).toBe(false)
    for (const field of ['organizationId', 'teamWorkspaceId', 'accountId', 'userId']) {
      expect(isExitEvidenceFor(result, { ...context, scope: { ...context.scope, [field]: 'other' } })).toBe(false)
    }
    expect(isExitEvidenceFor(result, { ...context, position: { ...context.position, revision: 3 } })).toBe(false)
    expect(Object.isFrozen(result.manifest.binding)).toBe(true)
    expect(Object.isFrozen(result.manifest.sessionBars[0].bar)).toBe(true)
    expect(result.manifest).toMatchObject({ evidenceClass: 'SYNTHETIC', binding: { entryExecutionId: 'entry-a', evaluationFingerprint: 'eval-a', intentFingerprint: 'intent-a', frozenPolicyFingerprint: context.policy.fingerprint }, rawPages: [{ sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }], contentHash: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(() => { result.manifest.binding.userId = 'changed' }).toThrow()
  })

  it('contains provider exceptions without leaking their content', async () => {
    const fixture = exitEvidenceFixture()
    fixture.source.retrieve = async () => { throw new Error('private provider detail') }
    expect(await createExitEvidenceService(fixture).getExitEvidence(fixture.context)).toEqual({ status: AUTHORITATIVE_CHRONOLOGY_UNAVAILABLE, reason: 'evidence_retrieval_failed' })
  })
})
