import { buildCanonicalPaperOutcomes } from '../../../lib/analytics/canonicalPaperOutcomes.js'
import { DEFAULT_PAPER_PERFORMANCE_REVIEW_CONFIG } from '../../../lib/analytics/paperPerformanceReviewConfig.js'
import { historicalContentFingerprint } from './historicalEvidenceContract.js'

const numeric = (value) => typeof value === 'number' && Number.isFinite(value)
const text = (value) => typeof value === 'string' && value.trim().length > 0
const unavailable = (reason) => ({ status: 'UNAVAILABLE', reason, outcomes: [], sourceFingerprint: null })

// Input is the existing scoped canonical ledger readExecutionHistory result.
// No journal, equity-difference, aggregate-performance, or raw P&L input path.
export function canonicalMonteCarloEvidence(input = {}, asOf) {
  const { executions, history } = input.canonicalExecutionHistory ?? {}
  if (!Array.isArray(executions) || !executions.length || history?.status !== 'COMPLETE' || history.hasEarlier !== false || history.returnedCount !== executions.length) return unavailable('COMPLETE_CANONICAL_EXECUTION_HISTORY_REQUIRED')
  if (!Number.isFinite(Date.parse(asOf))) return unavailable('INVALID_OUTCOME_CUTOFF')
  const ids = new Set()
  const accounts = new Set()
  for (const row of executions) {
    if (!row || !text(row.executionId) || ids.has(row.executionId) || !text(row.positionId) || !text(row.accountRecordId) || !text(row.accountId)
      || !['entry', 'reduction', 'close'].includes(row.executionType) || row.paperTradingOnly !== true
      || !text(row.symbol) || !text(row.strategyId) || !text(row.engineVersion)
      || !numeric(row.quantity) || row.quantity <= 0 || !numeric(row.fillPrice) || row.fillPrice <= 0
      || !numeric(row.fees) || row.fees < 0 || !numeric(row.slippageBps) || row.slippageBps < 0
      || !numeric(row.cashImpact) || !numeric(row.realizedPnlDelta)
      || !Number.isFinite(Date.parse(row.evidenceTimestamp)) || !Number.isFinite(Date.parse(row.createdAt))
      || Date.parse(row.evidenceTimestamp) > Date.parse(asOf) || Date.parse(row.createdAt) > Date.parse(asOf)) return unavailable('INVALID_CANONICAL_EXECUTION_EVIDENCE')
    ids.add(row.executionId)
    accounts.add(JSON.stringify([row.accountRecordId, row.accountId]))
  }
  if (accounts.size !== 1) return unavailable('MIXED_CANONICAL_ACCOUNTS')
  const measurement = buildCanonicalPaperOutcomes(executions, { history })
  if (measurement.exclusions.some((exclusion) => exclusion.reason !== 'OPEN_LIFECYCLE') || measurement.excludedOutcomes.length) return unavailable('UNRECONCILED_OR_UNATTRIBUTED_CANONICAL_OUTCOMES')
  const outcomes = measurement.outcomes
  const usedExecutions = new Set()
  for (const outcome of outcomes) {
    const rows = outcome.executionIds.map((id) => executions.find((row) => row.executionId === id))
    const orderedTimes = rows.every((row, index) => index === 0 || Date.parse(row.evidenceTimestamp) >= Date.parse(rows[index - 1].evidenceTimestamp))
    if (outcome.accountingStatus !== 'position_closed' || outcome.attribution.status !== 'COMPLETE'
      || outcome.pnlReconciliation.status !== 'RECONCILED' || outcome.quantityReconciliation.status !== 'RECONCILED'
      || !numeric(outcome.netPnl) || !outcome.cohortKey || !orderedTimes || Date.parse(outcome.closedAt) <= Date.parse(outcome.openedAt)
      || rows.some((row) => row.symbol !== outcome.symbol || row.strategyId !== outcome.strategyId || usedExecutions.has(row.executionId))) return unavailable('INVALID_COMPLETED_OUTCOME')
    rows.forEach((row) => usedExecutions.add(row.executionId))
  }
  if (new Set(outcomes.map((outcome) => outcome.cohortKey)).size > 1) return unavailable('MIXED_CANONICAL_COHORTS')
  if (outcomes.length < DEFAULT_PAPER_PERFORMANCE_REVIEW_CONFIG.minimumSample) return unavailable('INSUFFICIENT_CANONICAL_COMPLETED_OUTCOMES')
  // Sort independently of provider/DB row order before fingerprinting/sampling.
  const orderedOutcomes = [...outcomes].sort((a, b) => Date.parse(a.closedAt) - Date.parse(b.closedAt) || a.id.localeCompare(b.id))
  const source = orderedOutcomes.map((outcome) => ({
    id: outcome.id, openedAt: outcome.openedAt, closedAt: outcome.closedAt,
    netPnl: outcome.netPnl, costs: outcome.costs, cohortKey: outcome.cohortKey,
    executions: outcome.executionIds.map((id) => {
      const row = executions.find((execution) => execution.executionId === id)
      return { executionId: id, fingerprint: row.fingerprint ?? null, accountRecordId: row.accountRecordId, accountId: row.accountId, positionId: row.positionId, executionType: row.executionType, symbol: row.symbol, strategyId: row.strategyId, side: row.side ?? null, quantity: row.quantity, fillPrice: row.fillPrice, fees: row.fees, slippageBps: row.slippageBps, cashImpact: row.cashImpact, realizedPnlDelta: row.realizedPnlDelta, evidenceTimestamp: row.evidenceTimestamp, createdAt: row.createdAt, engineVersion: row.engineVersion ?? null, attribution: row.payload?.attribution ?? null }
    }),
  }))
  return {
    status: 'AVAILABLE',
    outcomes: orderedOutcomes,
    sourceFingerprint: historicalContentFingerprint({ version: measurement.version, source }),
    outcomeSource: measurement.version,
    cohortKey: orderedOutcomes[0].cohortKey,
    minimumSample: DEFAULT_PAPER_PERFORMANCE_REVIEW_CONFIG.minimumSample,
    excludedOpenLifecycles: measurement.exclusions.length,
    costTreatment: 'Canonical net cash outcomes include recorded entry/exit fees and fill-price slippage; no extra costs or reconstructed gross outcomes.',
  }
}
