export const CANONICAL_PAPER_OUTCOME_VERSION = 'canonical-paper-outcome-v1'

const finite = (value) => value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null
const round = (value, decimals = 2) => Number(Number(value).toFixed(decimals))
const timestamp = (execution = {}) => execution.evidenceTimestamp ?? execution.createdAt ?? null
const orderingTimestamp = (execution = {}) => execution.createdAt ?? execution.evidenceTimestamp ?? null

function ordered(executions = []) {
  return [...executions].sort((left, right) => {
    const createdTime = Date.parse(orderingTimestamp(left)) - Date.parse(orderingTimestamp(right))
    if (Number.isFinite(createdTime) && createdTime !== 0) return createdTime
    const evidenceTime = Date.parse(timestamp(left)) - Date.parse(timestamp(right))
    if (Number.isFinite(evidenceTime) && evidenceTime !== 0) return evidenceTime
    const rank = { entry: 0, reduction: 1, close: 2 }
    const typeOrder = (rank[left.executionType] ?? 3) - (rank[right.executionType] ?? 3)
    return typeOrder || String(left.executionId ?? left.fingerprint).localeCompare(String(right.executionId ?? right.fingerprint))
  })
}

function entryAttribution(execution = {}) {
  const payload = execution.payload ?? {}
  const observation = payload.forwardObservation ?? {}
  const exitPolicy = payload.exitPolicy ?? {}
  const attribution = payload.attribution ?? {}
  return {
    strategyFingerprint: attribution.strategyFingerprint ?? payload.strategyFingerprint ?? exitPolicy.strategyFingerprint ?? null,
    policyFingerprint: attribution.policyFingerprint ?? payload.policyFingerprint ?? exitPolicy.definitionFingerprint ?? null,
    evaluationFingerprint: attribution.evaluationFingerprint ?? payload.evaluationEvidenceFingerprint ?? null,
    experimentId: attribution.experimentId ?? observation.experimentId ?? null,
    observationId: attribution.observationId ?? observation.observationId ?? null,
    manifestFingerprint: attribution.manifestFingerprint ?? observation.manifestFingerprint ?? null,
  }
}

function plannedRisk(execution = {}) {
  const payload = execution.payload ?? {}
  return finite(payload.plannedRisk ?? payload.canonicalRiskDecision?.metrics?.dollarRisk ?? payload.orderPlan?.maximumRisk)
}

function commonValue(values) {
  const normalized = [...new Set(values.map((value) => value ?? null))]
  return normalized.length === 1 ? normalized[0] : undefined
}

function attributionFor(entries, closingExecution) {
  const entryValues = entries.map(entryAttribution)
  const strategyFingerprint = commonValue(entryValues.map((value) => value.strategyFingerprint))
  const policyFingerprint = commonValue(entryValues.map((value) => value.policyFingerprint))
  const experimentId = commonValue(entryValues.map((value) => value.experimentId))
  const observationId = commonValue(entryValues.map((value) => value.observationId))
  const manifestFingerprint = commonValue(entryValues.map((value) => value.manifestFingerprint))
  const evaluationFingerprints = [...new Set(entryValues.map((value) => value.evaluationFingerprint).filter(Boolean))]
  const missing = []
  const mixed = []
  if (strategyFingerprint === undefined) mixed.push('strategyFingerprint')
  else if (!strategyFingerprint) missing.push('strategyFingerprint')
  if (policyFingerprint === undefined) mixed.push('policyFingerprint')
  else if (!policyFingerprint) missing.push('policyFingerprint')
  if (entryValues.some((value) => !value.evaluationFingerprint)) missing.push('evaluationFingerprint')
  if (experimentId === undefined) mixed.push('experimentId')
  if (observationId === undefined) mixed.push('observationId')
  if (manifestFingerprint === undefined) mixed.push('manifestFingerprint')
  const forwardScoped = Boolean(experimentId || observationId || manifestFingerprint)
  if (forwardScoped) {
    if (!experimentId) missing.push('experimentId')
    if (!observationId) missing.push('observationId')
    if (!manifestFingerprint) missing.push('manifestFingerprint')
  }
  const closeAttribution = closingExecution.payload?.attribution ?? closingExecution.payload?.forwardObservation ?? {}
  if (forwardScoped && (closeAttribution.experimentId !== experimentId || closeAttribution.observationId !== observationId || closeAttribution.manifestFingerprint !== manifestFingerprint)) mixed.push('closingCohort')
  const status = mixed.length ? 'MIXED' : missing.length ? 'MISSING' : 'COMPLETE'
  const cohortKey = status === 'COMPLETE'
    ? JSON.stringify([strategyFingerprint, policyFingerprint, experimentId ?? null, observationId ?? null, manifestFingerprint ?? null])
    : null
  return {
    status,
    missing: [...new Set(missing)],
    mixed: [...new Set(mixed)],
    strategyFingerprint: strategyFingerprint ?? null,
    policyFingerprint: policyFingerprint ?? null,
    evaluationFingerprints,
    experimentId: experimentId ?? null,
    observationId: observationId ?? null,
    manifestFingerprint: manifestFingerprint ?? null,
    cohortKey,
  }
}

function equityPoint(execution, phase, equity) {
  return {
    executionId: execution.executionId ?? execution.fingerprint,
    timestamp: timestamp(execution),
    phase,
    equity: finite(equity),
  }
}

function equityChronology(executions) {
  const points = []
  const missingExecutionIds = []
  for (const execution of executions) {
    const before = finite(execution.payload?.valuation?.equity)
    const after = finite(execution.payload?.accountEquityAfter ?? execution.payload?.paperResult?.accountSnapshot?.equity)
    if (before != null) points.push(equityPoint(execution, 'before', before))
    if (after != null) points.push(equityPoint(execution, 'after', after))
    if (before == null || after == null) missingExecutionIds.push(execution.executionId ?? execution.fingerprint)
  }
  return {
    status: missingExecutionIds.length ? 'INCOMPLETE' : 'COMPLETE',
    points,
    missingExecutionIds,
  }
}

function outcomeFrom(lifecycle, closingExecution) {
  const entries = lifecycle.executions.filter((execution) => execution.executionType === 'entry')
  const reductions = lifecycle.executions.filter((execution) => execution.executionType === 'reduction')
  const allExecutions = [...lifecycle.executions, closingExecution]
  const netCashChange = round(allExecutions.reduce((sum, execution) => sum + (finite(execution.cashImpact) ?? 0), 0))
  const realizedNetPnl = round(allExecutions.filter((execution) => execution.executionType !== 'entry').reduce((sum, execution) => sum + (finite(execution.realizedPnlDelta) ?? 0), 0))
  const entryCosts = round(entries.reduce((sum, execution) => sum + (finite(execution.fees) ?? 0), 0))
  const exitCosts = round([...reductions, closingExecution].reduce((sum, execution) => sum + (finite(execution.fees) ?? 0), 0))
  const risks = entries.map(plannedRisk)
  const immutablePlannedRisk = risks.every((risk) => risk != null && risk > 0) ? round(risks.reduce((sum, risk) => sum + risk, 0)) : null
  const attribution = attributionFor(entries, closingExecution)
  const quantityOpened = round(entries.reduce((sum, execution) => sum + (finite(execution.quantity) ?? 0), 0), 8)
  const quantityClosed = round([...reductions, closingExecution].reduce((sum, execution) => sum + (finite(execution.quantity) ?? 0), 0), 8)
  const quantityReconciled = Math.abs(quantityOpened - quantityClosed) < 1e-8
  const pnlReconciled = Math.abs(netCashChange - realizedNetPnl) < 0.011
  return {
    version: CANONICAL_PAPER_OUTCOME_VERSION,
    id: `paper-outcome-${entries[0]?.executionId ?? entries[0]?.fingerprint ?? closingExecution.executionId ?? closingExecution.fingerprint}`,
    positionId: closingExecution.positionId,
    symbol: closingExecution.symbol,
    strategyId: closingExecution.strategyId ?? entries[0]?.strategyId ?? null,
    assetType: closingExecution.payload?.assetType ?? entries[0]?.payload?.assetType ?? null,
    status: 'SIMULATED_FILLED',
    accountingStatus: 'position_closed',
    openedAt: timestamp(entries[0]),
    closedAt: timestamp(closingExecution),
    executionIds: allExecutions.map((execution) => execution.executionId ?? execution.fingerprint),
    entryExecutionIds: entries.map((execution) => execution.executionId ?? execution.fingerprint),
    reductionExecutionIds: reductions.map((execution) => execution.executionId ?? execution.fingerprint),
    closingExecutionId: closingExecution.executionId ?? closingExecution.fingerprint,
    quantityOpened,
    quantityClosed,
    netPnl: netCashChange,
    realizedPnl: netCashChange,
    ledgerRealizedPnl: realizedNetPnl,
    grossPnl: round(netCashChange + entryCosts + exitCosts),
    costs: { entry: entryCosts, exit: exitCosts, total: round(entryCosts + exitCosts) },
    pnlReconciliation: { status: pnlReconciled ? 'RECONCILED' : 'MISMATCH', netCashChange, ledgerRealizedPnl: realizedNetPnl },
    quantityReconciliation: { status: quantityReconciled ? 'RECONCILED' : 'MISMATCH', opened: quantityOpened, closed: quantityClosed },
    immutablePlannedRisk,
    rMultiple: immutablePlannedRisk == null ? null : Number((netCashChange / immutablePlannedRisk).toFixed(4)),
    attribution,
    cohortKey: attribution.cohortKey,
    experimentId: attribution.experimentId,
    forwardObservation: attribution.experimentId ? { experimentId: attribution.experimentId, observationId: attribution.observationId, manifestFingerprint: attribution.manifestFingerprint } : null,
    exitAttribution: closingExecution.payload?.exitAttribution ?? null,
    tradeQuality: entries[0]?.payload?.tradeQuality ?? null,
    regime: entries[0]?.payload?.regime ?? null,
    evaluationStatus: entries[0]?.payload?.evaluationStatus ?? null,
    accountEquityBefore: finite(closingExecution.payload?.valuation?.equity),
    accountEquityAfter: finite(closingExecution.payload?.accountEquityAfter ?? closingExecution.payload?.paperResult?.accountSnapshot?.equity),
    paperTradingOnly: true,
  }
}

export function buildCanonicalPaperOutcomes(executions = [], options = {}) {
  const rows = ordered(Array.isArray(executions) ? executions : [])
  const active = new Map()
  const outcomes = []
  const exclusions = []
  for (const execution of rows) {
    const positionId = execution.positionId
    if (!positionId) {
      exclusions.push({ executionId: execution.executionId ?? execution.fingerprint, reason: 'POSITION_ID_MISSING' })
      continue
    }
    if (execution.executionType === 'entry') {
      const lifecycle = active.get(positionId) ?? { executions: [], quantity: 0 }
      lifecycle.executions.push(execution)
      lifecycle.quantity += finite(execution.quantity) ?? 0
      active.set(positionId, lifecycle)
      continue
    }
    const lifecycle = active.get(positionId)
    if (!lifecycle?.executions?.length) {
      exclusions.push({ executionId: execution.executionId ?? execution.fingerprint, reason: 'ENTRY_LIFECYCLE_MISSING' })
      continue
    }
    if (execution.executionType === 'reduction') {
      lifecycle.executions.push(execution)
      lifecycle.quantity -= finite(execution.quantity) ?? 0
      continue
    }
    if (execution.executionType === 'close') {
      const outcome = outcomeFrom(lifecycle, execution)
      outcomes.push(outcome)
      if (outcome.quantityReconciliation.status !== 'RECONCILED') exclusions.push({ outcomeId: outcome.id, reason: 'QUANTITY_RECONCILIATION_MISMATCH' })
      active.delete(positionId)
    }
  }
  for (const [positionId, lifecycle] of active) {
    exclusions.push({ positionId, executionIds: lifecycle.executions.map((execution) => execution.executionId ?? execution.fingerprint), reason: 'OPEN_LIFECYCLE' })
  }
  const comparableOutcomes = outcomes.filter((outcome) => outcome.attribution.status === 'COMPLETE' && outcome.quantityReconciliation.status === 'RECONCILED')
  const excludedOutcomes = outcomes.filter((outcome) => !comparableOutcomes.includes(outcome)).map((outcome) => ({ outcomeId: outcome.id, reason: outcome.attribution.status !== 'COMPLETE' ? `ATTRIBUTION_${outcome.attribution.status}` : 'QUANTITY_RECONCILIATION_MISMATCH', details: outcome.attribution }))
  const history = options.history ?? { status: 'PROVIDED', returnedCount: rows.length, latest: true }
  return {
    version: CANONICAL_PAPER_OUTCOME_VERSION,
    outcomes,
    comparableOutcomes,
    excludedOutcomes,
    exclusions,
    equityChronology: equityChronology(rows),
    history,
    boundaries: { paperTradingOnly: true, oneOutcomePerClosedLifecycle: true, reductionsAreNotOutcomes: true, immutableEntryRiskOnly: true },
  }
}

export function latestCanonicalOutcomes(measurement, limit) {
  const count = Math.max(0, Number(limit) || 0)
  return count ? measurement.outcomes.slice(-count) : []
}
