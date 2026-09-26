import { createIndexPullbackExitPolicy } from '../../lib/opportunities/forwardTest/indexPullbackExitPolicy.js'

// Tiny artificial sessions: arithmetic/contract tests only, never an exchange calendar.
// GENUINE may be requested solely to exercise the isolated fake PostgreSQL harness.
export function exitEvidenceFixture({ count = 1, side = 'long', evidenceClass = 'SYNTHETIC', entryAt = '2026-08-13T12:00:30.000Z', mutate = () => {} } = {}) {
  const entryDay = entryAt.slice(0, 10)
  const days = Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.parse(`${entryDay}T00:00:00Z`) + index * 86400000).toISOString().slice(0, 10)
    return { date, sessions: [{ id: `fixture-session-${index + 1}`, openAt: `${date}T12:00:00.000Z`, closeAt: `${date}T12:04:00.000Z` }] }
  })
  const now = `${days.at(-1).date}T12:05:00.000Z`
  const policy = createIndexPullbackExitPolicy({ strategyId: 'index-pullback-v1', strategyVersion: '1.2.0', side, entryPrice: 100, stopPrice: side === 'long' ? 98 : 102, targetPrice: side === 'long' ? 104 : 96, enteredAt: entryAt })
  const context = {
    scope: { organizationId: 'org-a', teamWorkspaceId: 'team-a', userId: 'user-a', accountId: 'paper-portfolio' },
    position: { positionId: 'pos-a', accountRecordId: 'account-a', revision: 2, quantity: 10, side, symbol: 'AAPL', originatingIntentFingerprint: 'intent-a', exitPolicy: policy },
    entry: { executionId: 'entry-a', executedAt: entryAt, fillPrice: 100, positionId: 'pos-a', evaluationEvidenceFingerprint: 'eval-a', executionIntentFingerprint: 'intent-a', exitPolicy: policy,
      entryChronology: { version: 'paper-entry-ledger-clock-v1', timeBasis: 'execution_created_at' } }, policy,
  }
  const qualification = { provider: 'controlled-fixture', source: 'memory-fixture', reference: 'controlled-case-only', evidenceClass,
    instruments: [{ symbol: 'AAPL', mic: 'XNAS', timezone: 'UTC' }],
    validFrom: `${entryDay}T00:00:00Z`, validUntil: `${days.at(-1).date}T23:59:59Z`,
    capabilities: Object.fromEntries(['finalMinutes', 'completePagination', 'completeCalendar', 'sessionOpenClose', 'corporateActions', 'retainedContent'].map((key) => [key, true])) }
  const source = { provider: qualification.provider, id: qualification.source, async retrieve(request) {
    const minutes = days.flatMap((day) => Array.from({ length: 4 }, (_, index) => ({
      sessionId: day.sessions[0].id, startAt: `${day.date}T12:0${index}:00.000Z`, endAt: `${day.date}T12:0${index + 1}:00.000Z`,
      open: 100, high: 101, low: 99, close: 100,
    })))
    const data = { provider: source.provider, source: source.id, evidenceClass, request,
      instrument: { symbol: request.symbol, mic: 'XNAS', timezone: 'UTC' },
      quality: { finality: 'FINAL', corrections: 'RESOLVED', completeness: 'COMPLETE', paginationComplete: true, snapshotId: 'fixture-revision-1', finalAsOf: now },
      corporateActions: { status: 'NO_ACTIONS', basis: 'UNADJUSTED', entryExecutionId: request.entryExecutionId, from: request.from, through: now, reference: 'fixture-actions' },
      calendar: { id: 'artificial-four-minute-calendar', revision: 'fixture-1', complete: true, mic: 'XNAS', timezone: 'UTC', days: structuredClone(days) },
    }
    mutate(data, minutes)
    data.sessionPrices ??= days.map((day) => ({ sessionId: day.sessions[0].id, status: 'VERIFIED_FINAL', reference: 'fixture-prices',
      open: minutes.find((minute) => minute.sessionId === day.sessions[0].id)?.open,
      close: minutes.filter((minute) => minute.sessionId === day.sessions[0].id).at(-1)?.close }))
    data.pages = [{ id: 'page-1', archiveReference: 'fixture-only:page-1', rawContent: JSON.stringify({ fixtureMinutes: minutes }), content: JSON.stringify({ minutes }) }]
    return data
  } }
  return { context, source, qualification, clock: () => now, now }
}
