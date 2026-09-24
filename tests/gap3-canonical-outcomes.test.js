import { describe, expect, it } from 'vitest'
import { buildCanonicalPaperOutcomes, latestCanonicalOutcomes } from '../lib/analytics/canonicalPaperOutcomes.js'
import { reviewPaperPerformance } from '../lib/analytics/paperPerformanceReview.js'
import { createCanonicalPaperLedgerRepository } from '../lib/opportunities/persistence/canonicalPaperLedgerRepository.js'

const at = (hour) => `2026-09-24T${String(hour).padStart(2, '0')}:00:00.000Z`
const attribution = (overrides = {}) => ({ strategyFingerprint: 'strategy-a', policyFingerprint: 'policy-a', evaluationFingerprint: 'evaluation-a', experimentId: null, observationId: null, manifestFingerprint: null, ...overrides })
const execution = (overrides = {}) => ({
  executionId: overrides.executionId,
  positionId: overrides.positionId ?? 'position-a',
  executionType: overrides.executionType,
  symbol: overrides.symbol ?? 'AAPL',
  strategyId: overrides.strategyId ?? 'strategy-1',
  quantity: overrides.quantity,
  fees: overrides.fees,
  cashImpact: overrides.cashImpact,
  realizedPnlDelta: overrides.realizedPnlDelta ?? 0,
  evidenceTimestamp: overrides.evidenceTimestamp,
  payload: {
    assetType: 'equity',
    attribution: overrides.attribution ?? attribution(),
    plannedRisk: overrides.plannedRisk,
    valuation: { equity: overrides.equityBefore },
    accountEquityAfter: overrides.equityAfter,
    exitAttribution: overrides.exitAttribution ?? null,
  },
})

function roundTrip({ id = 'a', positionId = `position-${id}`, entryFee = 1, exitFee = 2, pnl = 100, plannedRisk = 20, attrs = attribution(), start = 10 } = {}) {
  return [
    execution({ executionId: `${id}-entry`, positionId, executionType: 'entry', quantity: 10, fees: entryFee, cashImpact: -(1000 + entryFee), plannedRisk, attribution: attrs, evidenceTimestamp: at(start), equityBefore: 100000, equityAfter: 100000 - entryFee }),
    execution({ executionId: `${id}-close`, positionId, executionType: 'close', quantity: 10, fees: exitFee, cashImpact: 1000 + pnl - exitFee, realizedPnlDelta: pnl - entryFee - exitFee, attribution: attrs, evidenceTimestamp: at(start + 1), equityBefore: 100000 + pnl, equityAfter: 100000 + pnl - entryFee - exitFee }),
  ]
}

describe('Gap 3 canonical outcome contract', () => {
  it('reconciles a full round trip to canonical cash including both-side fees and immutable R', () => {
    const measurement = buildCanonicalPaperOutcomes(roundTrip())
    expect(measurement.outcomes).toHaveLength(1)
    expect(measurement.outcomes[0]).toMatchObject({ netPnl: 97, grossPnl: 100, costs: { entry: 1, exit: 2, total: 3 }, immutablePlannedRisk: 20, rMultiple: 4.85, pnlReconciliation: { status: 'RECONCILED' } })
  })

  it('allocates reductions into one final outcome without inflating sample size', () => {
    const attrs = attribution()
    const rows = [
      execution({ executionId: 'partial-entry', executionType: 'entry', quantity: 10, fees: 1, cashImpact: -1001, plannedRisk: 20, attribution: attrs, evidenceTimestamp: at(10), equityBefore: 100000, equityAfter: 99999 }),
      execution({ executionId: 'partial-reduction', executionType: 'reduction', quantity: 4, fees: 1, cashImpact: 439, realizedPnlDelta: 38.6, attribution: attrs, evidenceTimestamp: at(11), equityBefore: 100100, equityAfter: 100098.6 }),
      execution({ executionId: 'partial-close', executionType: 'close', quantity: 6, fees: 1, cashImpact: 659, realizedPnlDelta: 58.4, attribution: attrs, evidenceTimestamp: at(12), equityBefore: 100100, equityAfter: 100097 }),
    ]
    const measurement = buildCanonicalPaperOutcomes(rows)
    const review = reviewPaperPerformance(measurement.outcomes, { cohortIsolation: true, equityChronology: measurement.equityChronology })
    expect(measurement.outcomes[0]).toMatchObject({ netPnl: 97, reductionExecutionIds: ['partial-reduction'], quantityReconciliation: { status: 'RECONCILED' } })
    expect(review.sample.completedTrades).toBe(1)
  })

  it('keeps winner and loser outcomes separate across positions and uses latest N', () => {
    const measurement = buildCanonicalPaperOutcomes([...roundTrip({ id: 'winner', pnl: 100, start: 8 }), ...roundTrip({ id: 'loser', pnl: -50, start: 12 })])
    expect(measurement.outcomes.map((outcome) => outcome.netPnl)).toEqual([97, -53])
    expect(latestCanonicalOutcomes(measurement, 1).map((outcome) => outcome.id)).toEqual(['paper-outcome-loser-entry'])
  })

  it('fails R closed when immutable entry risk is missing', () => {
    const outcome = buildCanonicalPaperOutcomes(roundTrip({ plannedRisk: null })).outcomes[0]
    expect(outcome).toMatchObject({ immutablePlannedRisk: null, rMultiple: null })
  })

  it('excludes missing and mixed immutable attribution from comparable metrics', () => {
    const missing = buildCanonicalPaperOutcomes(roundTrip({ attrs: attribution({ strategyFingerprint: null }) }))
    expect(missing.comparableOutcomes).toEqual([])
    expect(missing.excludedOutcomes[0].reason).toBe('ATTRIBUTION_MISSING')
    const mixedRows = roundTrip()
    mixedRows[0].payload.attribution.strategyFingerprint = 'strategy-a'
    mixedRows.push(execution({ executionId: 'scale-entry', executionType: 'entry', quantity: 1, fees: 0, cashImpact: -100, plannedRisk: 2, attribution: attribution({ strategyFingerprint: 'strategy-b' }), evidenceTimestamp: at(10), equityBefore: 100000, equityAfter: 100000 }))
    mixedRows.sort((left, right) => Date.parse(left.evidenceTimestamp) - Date.parse(right.evidenceTimestamp))
    const mixed = buildCanonicalPaperOutcomes(mixedRows)
    expect(mixed.outcomes[0].attribution.status).toBe('MIXED')
    expect(reviewPaperPerformance(mixed.outcomes, { cohortIsolation: true, equityChronology: mixed.equityChronology }).sample.completedTrades).toBe(0)
  })

  it('derives peak, drawdown, and recovery only from complete canonical account equity chronology', () => {
    const outcomes = buildCanonicalPaperOutcomes([...roundTrip({ id: 'one', start: 8 }), ...roundTrip({ id: 'two', pnl: -10000, start: 12 })])
    const review = reviewPaperPerformance(outcomes.outcomes, { cohortIsolation: true, equityChronology: { status: 'COMPLETE', points: [100000, 120000, 90000, 110000, 125000].map((equity, index) => ({ equity, index, timestamp: at(index + 1) })) } })
    expect(review.performance).toMatchObject({ drawdownStatus: 'AVAILABLE', maximumDrawdownPct: 25, accountEquityDrawdown: { maximumDrawdownPeakEquity: 120000, troughEquity: 90000, recoveryStatus: 'RECOVERED', endingEquity: 125000 } })
    const unavailable = reviewPaperPerformance(outcomes.outcomes, { cohortIsolation: true, equityChronology: { status: 'INCOMPLETE', points: [] } })
    expect(unavailable.performance).toMatchObject({ drawdownStatus: 'UNAVAILABLE', maximumDrawdownPct: null })
  })

  it('keeps exact manifest cohorts isolated from unrelated experiment, account, and tenant input', () => {
    const edge = attribution({ experimentId: 'EDGE.2', observationId: 'edge-a', manifestFingerprint: 'manifest-a' })
    const other = attribution({ experimentId: 'BREAKOUT.1', observationId: 'breakout-a', manifestFingerprint: 'manifest-b' })
    const measurement = buildCanonicalPaperOutcomes([...roundTrip({ id: 'edge', attrs: edge, start: 8 }), ...roundTrip({ id: 'other', attrs: other, start: 12 })])
    const exact = measurement.outcomes.filter((outcome) => outcome.forwardObservation?.experimentId === 'EDGE.2' && outcome.forwardObservation?.manifestFingerprint === 'manifest-a')
    expect(exact).toHaveLength(1)
    expect(reviewPaperPerformance(measurement.outcomes, { cohortIsolation: true, equityChronology: measurement.equityChronology }).status).toBe('INCOMPATIBLE_COHORTS')
  })

  it('reads history beyond the former default cap and returns the actual latest N records', async () => {
    const rows = Array.from({ length: 205 }, (_, index) => ({ id: `execution-${String(index).padStart(3, '0')}`, organization_id: 'org-a', team_workspace_id: 'team-a', account_id: 'paper-a', user_id: 'user-a', position_id: `position-${index}`, execution_type: 'entry', symbol: 'AAPL', side: 'buy', quantity: 1, fill_price: 1, fees: 0, cash_impact: -1, realized_pnl_delta: 0, evidence_timestamp: at(1), engine_version: 'test', payload: {}, created_at: new Date(Date.UTC(2026, 8, 1, 0, index)).toISOString() }))
    const database = {
      connected: true,
      transaction: async (callback) => callback(database),
      query: async (sql, params) => {
        if (!String(sql).includes('atlas_paper_executions')) throw new Error('unexpected query')
        const scoped = rows.filter((row) => row.organization_id === params[0] && row.team_workspace_id === params[1] && row.account_id === params[2] && row.user_id === params[3])
        return String(sql).includes('ORDER BY created_at DESC') ? { rows: scoped.slice(-(params[4] ?? scoped.length)) } : { rows: scoped }
      },
    }
    const repository = createCanonicalPaperLedgerRepository({ database })
    const scope = { tenantContext: { organizationId: 'org-a', teamWorkspaceId: 'team-a', userId: 'user-a' }, accountId: 'paper-a', userId: 'user-a' }
    const complete = await repository.readExecutionHistory(scope)
    const latest = await repository.readExecutionHistory({ ...scope, limit: 5 })
    expect(complete).toMatchObject({ history: { status: 'COMPLETE', returnedCount: 205 }, executions: expect.any(Array) })
    expect(latest).toMatchObject({ history: { status: 'WINDOWED', returnedCount: 5, hasEarlier: true, latest: true } })
    expect(latest.executions.map((row) => row.executionId)).toEqual(['execution-200', 'execution-201', 'execution-202', 'execution-203', 'execution-204'])
  })
})
