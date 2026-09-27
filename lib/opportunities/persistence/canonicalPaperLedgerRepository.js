import { AppError } from '../../errors/appError.js'
import { randomUUID } from 'node:crypto'
import { getAssetProfile, normalizeAssetType, SUPPORTED_ASSET_TYPES } from '../../assets/index.js'
import { applyPaperPortfolioAccounting } from '../../../src/core/accounting/paperPortfolioAccountingEngine.js'
import { simulateTradeExecution } from '../../../src/core/execution/executionSimulationEngine.js'
import { evaluatePortfolioRisk } from '../../../src/core/risk/portfolioRiskEngine.js'
import { evaluateTradeGuardrail } from '../../../src/core/risk/tradeGuardrailEngine.js'
import { simulatePaperPositionExit, createPaperExitFingerprint, POLICY_EXIT_EVIDENCE_BLOCKER } from '../paperExit/index.js'
import { createExitEvidenceService, isExitEvidenceFor, AUTHORITATIVE_CHRONOLOGY_UNAVAILABLE } from '../paperExit/exitEvidence.js'
import { DEFAULT_PAPER_EXIT_CONFIG } from '../paperExit/paperExitConfig.js'
import { appendExecutionAccountingEvidence, appendOpeningFundingEvidence } from './accountingEvidenceRepository.js'
import {
  currentMarketEvidenceFingerprint,
  validateCurrentMarketEvidence,
  validateCurrentMarketEvidenceBundle,
} from '../../market/currentMarketEvidenceContract.js'

export const PAPER_LEDGER_ERRORS = Object.freeze({
  unavailable: 'paper_ledger_unavailable',
  invalidScope: 'paper_ledger_tenant_scope_invalid',
  evidenceMissing: 'paper_ledger_evidence_missing',
  conflict: 'paper_ledger_conflict',
  inconsistent: 'paper_ledger_state_inconsistent',
  marksUnavailable: 'paper_ledger_marks_unavailable',
  riskUnknown: 'paper_ledger_risk_state_unknown',
  riskLatchBlocked: 'paper_risk_latch_blocked',
  riskLatchUnavailable: 'paper_risk_latch_unavailable',
  riskLatchResetDenied: 'paper_risk_latch_reset_denied',
  riskLatchConflict: 'paper_risk_latch_conflict',
})

export const DEFAULT_INITIAL_PAPER_BALANCE = 100_000
const CANONICAL_RISK_COMMITMENT_VERSION = 'canonical-paper-risk-commitment-v2'
const EXECUTION_QUOTE_MAX_AGE_MS = 30_000
const UNQUALIFIED_EXIT_COST_COMPONENTS = Object.freeze([
  Object.freeze({ component: 'adverse_gap_beyond_stop', status: 'UNQUALIFIED_FUTURE_MARKET_EVIDENCE' }),
  Object.freeze({ component: 'conditional_low_liquidity_slippage_and_fee_variance', status: 'UNQUALIFIED_FUTURE_MARKET_EVIDENCE' }),
])

function ledgerError(code, detail, statusCode = 503, publicMessage = 'paper ledger is unavailable') {
  return new AppError(code, detail, {
    statusCode,
    publicMessage,
    metadata: { paperTradingOnly: true },
  })
}

function finite(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function normalizedScope(input = {}) {
  const tenant = input.tenantContext ?? input.tenantScope ?? {}
  const scope = {
    organizationId: String(tenant.organizationId ?? '').trim(),
    teamWorkspaceId: String(tenant.teamWorkspaceId ?? '').trim(),
    accountId: String(input.accountId ?? '').trim(),
    userId: String(input.userId ?? tenant.userId ?? '').trim(),
  }
  if (!scope.organizationId || !scope.accountId || !scope.userId) {
    throw ledgerError(PAPER_LEDGER_ERRORS.invalidScope, 'Organization, account, and user scope are required.', 403, 'paper ledger tenant scope is invalid')
  }
  return scope
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function scopedId(prefix, values) {
  return `${prefix}-${await sha256(values)}`
}

function accountFromRow(row = {}) {
  return {
    recordId: row.id,
    accountId: row.account_id ?? row.accountId,
    organizationId: row.organization_id ?? row.organizationId,
    teamWorkspaceId: row.team_workspace_id ?? row.teamWorkspaceId ?? null,
    userId: row.user_id ?? row.userId,
    cash: finite(row.cash),
    buyingPower: finite(row.buying_power ?? row.buyingPower),
    equity: finite(row.equity),
    realizedPnl: finite(row.realized_pnl ?? row.realizedPnl),
    revision: finite(row.revision),
    accountingOriginId: row.accounting_origin_id ?? row.accountingOriginId ?? null,
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
    paperTradingOnly: true,
  }
}

function positionFromRow(row = {}) {
  const riskState = row.risk_state ?? row.riskState ?? null
  return {
    positionId: row.id,
    accountRecordId: row.account_record_id ?? row.accountRecordId,
    accountId: row.account_id ?? row.accountId,
    symbol: String(row.symbol ?? '').toUpperCase(),
    assetType: row.asset_type ?? row.assetType,
    side: row.side,
    quantity: finite(row.quantity),
    averagePrice: finite(row.average_cost ?? row.averagePrice),
    currentPrice: finite(row.current_price ?? row.currentPrice ?? row.average_cost),
    markEvidenceTimestamp: row.mark_evidence_timestamp ?? row.markEvidenceTimestamp ?? null,
    riskState,
    realizedPnl: finite(row.realized_pnl ?? row.realizedPnl),
    originatingCandidateId: row.originating_candidate_id ?? row.originatingCandidateId ?? null,
    originatingEvaluationId: row.originating_evaluation_id ?? row.originatingEvaluationId ?? null,
    originatingIntentFingerprint: row.originating_intent_fingerprint ?? row.originatingIntentFingerprint ?? null,
    strategyId: row.strategy_id ?? row.strategyId ?? null,
    status: row.status ?? (finite(row.quantity) > 0 ? 'open' : 'closed'),
    revision: finite(row.revision),
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
    paperTradingOnly: true,
  }
}

function executionFromRow(row = {}) {
  const payload = row.payload ?? {}
  return {
    executionId: row.id ?? payload.executionId,
    accountRecordId: row.account_record_id ?? payload.accountRecordId,
    accountId: row.account_id ?? payload.accountId,
    positionId: row.position_id ?? payload.positionId,
    executionType: row.execution_type ?? payload.executionType,
    fingerprint: row.idempotency_fingerprint ?? payload.fingerprint,
    symbol: row.symbol ?? payload.symbol,
    strategyId: row.strategy_id ?? payload.strategyId,
    side: row.side ?? payload.side,
    quantity: finite(row.quantity ?? payload.quantity),
    fillPrice: finite(row.fill_price ?? payload.fillPrice),
    fees: finite(row.fees ?? payload.fees),
    slippageBps: finite(row.slippage_bps ?? payload.slippageBps),
    cashImpact: finite(row.cash_impact ?? payload.cashImpact),
    realizedPnlDelta: finite(row.realized_pnl_delta ?? payload.realizedPnlDelta),
    evidenceTimestamp: row.evidence_timestamp ?? payload.evidenceTimestamp,
    engineVersion: row.engine_version ?? payload.engineVersion,
    payload,
    createdAt: row.created_at ?? payload.createdAt ?? null,
    paperTradingOnly: true,
  }
}

function compactExecutionPayload(input = {}) {
  return {
    executionId: input.executionId,
    accountRecordId: input.accountRecordId,
    accountId: input.accountId,
    positionId: input.positionId,
    executionType: input.executionType,
    fingerprint: input.fingerprint,
    candidateId: input.candidateId ?? null,
    evaluationId: input.evaluationId ?? null,
    evaluationEvidenceFingerprint: input.evaluationEvidenceFingerprint ?? null,
    executionIntentFingerprint: input.executionIntentFingerprint ?? null,
    strategyId: input.strategyId ?? null,
    symbol: input.symbol,
    assetType: input.assetType,
    side: input.side,
    quantity: input.quantity,
    fillPrice: input.fillPrice,
    fees: input.fees,
    slippageBps: input.slippageBps,
    cashImpact: input.cashImpact,
    realizedPnlDelta: input.realizedPnlDelta,
    accountingStatus: input.accountingStatus,
    evidenceTimestamp: input.evidenceTimestamp,
    engineVersion: input.engineVersion,
    journal: input.journal ?? null,
    tradeQuality: input.tradeQuality ?? null,
    regime: input.regime ?? null,
    evaluationStatus: input.evaluationStatus ?? null,
    exitPolicy: input.exitPolicy ?? null,
    exitAttribution: input.exitAttribution ?? null,
    exitEvidenceManifest: input.exitEvidenceManifest ?? null,
    forwardObservation: input.forwardObservation ?? null,
    entryEvidence: input.entryEvidence ?? null,
    entryChronology: input.entryChronology ?? null,
    executionRealism: input.executionRealism ?? null,
    executionCalibrationStatus: input.executionCalibrationStatus ?? null,
    exitCostTreatment: input.exitCostTreatment ?? null,
    accountRevision: input.accountRevision ?? null,
    valuation: input.valuation ?? null,
    riskState: input.riskState ?? null,
    canonicalRiskDecision: input.canonicalRiskDecision ?? null,
    plannedRisk: input.plannedRisk ?? null,
    attribution: input.attribution ?? null,
    entryFeeAllocation: input.entryFeeAllocation ?? 0,
    accountCashAfter: input.accountCashAfter ?? null,
    accountEquityAfter: input.accountEquityAfter ?? null,
    accountRealizedPnlAfter: input.accountRealizedPnlAfter ?? null,
    paperTradingOnly: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

async function ensureAccount(client, scope, initialBalance, { lock = false } = {}) {
  const id = await scopedId('paper-account', [scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId])
  const accountingOriginId = randomUUID()
  const inserted = await client.query(
    `INSERT INTO atlas_paper_accounts
      (id, organization_id, team_workspace_id, account_id, user_id, accounting_origin_id, cash, buying_power, equity, realized_pnl, revision, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$7,0,0,clock_timestamp(),clock_timestamp())
     ON CONFLICT DO NOTHING RETURNING *`,
    [id, scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId, accountingOriginId, initialBalance],
  )
  if (inserted.rows?.[0]) {
    await client.query(
      `INSERT INTO atlas_paper_risk_latches
        (account_record_id,organization_id,team_workspace_id,account_id,user_id,latch_state,reason,changed_by_user_id,changed_by_role,revision,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,'CLEAR','canonical_account_initialization','system','system',0,NOW(),NOW())`,
      [id, scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId],
    )
    await appendOpeningFundingEvidence(client, { account: inserted.rows[0], scope, amount: initialBalance })
  }
  const result = await client.query(
    `SELECT * FROM atlas_paper_accounts
     WHERE organization_id=$1 AND team_workspace_id=$2 AND account_id=$3 AND user_id=$4
     ${lock ? 'FOR UPDATE' : ''}`,
    [scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId],
  )
  if (!result.rows?.[0]) throw ledgerError(PAPER_LEDGER_ERRORS.inconsistent, 'Canonical paper account could not be loaded.')
  return accountFromRow(result.rows[0])
}

function riskLatchFromRow(row = {}) {
  const revision = Number(row.revision)
  if (!['CLEAR', 'BLOCKED'].includes(row.latch_state) || !Number.isSafeInteger(revision) || revision < 0) return null
  return {
    state: row.latch_state,
    reason: row.reason,
    changedByUserId: row.changed_by_user_id,
    changedByRole: row.changed_by_role,
    revision,
    updatedAt: row.updated_at,
    paperTradingOnly: true,
  }
}

async function loadRiskLatch(client, account, scope, { lock = false, allowMissing = false } = {}) {
  let result
  try {
    result = await client.query(
      `SELECT * FROM atlas_paper_risk_latches
       WHERE account_record_id=$1 AND organization_id=$2 AND team_workspace_id=$3 AND account_id=$4 AND user_id=$5
       ${lock ? 'FOR UPDATE' : ''}`,
      [account.recordId, scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId],
    )
  } catch (error) {
    throw ledgerError(PAPER_LEDGER_ERRORS.riskLatchUnavailable, `Durable PAPER risk latch could not be read: ${error?.message ?? 'unknown database failure'}`, 503, 'paper risk latch is unavailable')
  }
  if (!result.rows?.[0]) {
    if (allowMissing) return null
    throw ledgerError(PAPER_LEDGER_ERRORS.riskLatchBlocked, 'Durable PAPER risk latch state is missing.', 409, 'paper risk latch is blocked')
  }
  const latch = riskLatchFromRow(result.rows[0])
  if (!latch) throw ledgerError(PAPER_LEDGER_ERRORS.riskLatchBlocked, 'Durable PAPER risk latch state is unreadable.', 409, 'paper risk latch is blocked')
  return latch
}

function assertAuthenticatedHumanActor(actor = {}, scope) {
  const role = String(actor.role ?? '')
  const userId = String(actor.userId ?? '')
  if (actor.source !== 'authenticated_human_request' || !['owner', 'admin'].includes(role) || !userId || userId !== scope.userId) {
    throw ledgerError(PAPER_LEDGER_ERRORS.riskLatchResetDenied, 'PAPER risk latch action requires authenticated owner/admin human authority.', 403, 'paper risk latch action denied')
  }
  return { userId, role }
}

function requireLatchReason(value) {
  const reason = String(value ?? '').trim()
  if (reason.length < 8 || reason.length > 500) {
    throw ledgerError(PAPER_LEDGER_ERRORS.riskLatchResetDenied, 'PAPER risk latch action requires an explicit reason between 8 and 500 characters.', 400, 'paper risk latch reason is required')
  }
  return reason
}

async function loadPositions(client, accountRecordId, { lock = false, includeClosed = false } = {}) {
  const result = await client.query(
    `SELECT * FROM atlas_paper_positions
     WHERE account_record_id=$1 ${includeClosed ? '' : "AND status='open' AND quantity>0"}
     ORDER BY symbol, asset_type, side
     ${lock ? 'FOR UPDATE' : ''}`,
    [accountRecordId],
  )
  return (result.rows ?? []).map(positionFromRow)
}

function round(value, decimals = 2) {
  return Number(finite(value).toFixed(decimals))
}

function roundRiskUp(value, decimals = 2) {
  const factor = 10 ** decimals
  const scaled = Number(value) * factor
  if (!Number.isFinite(scaled)) return NaN
  const nearest = Math.round(scaled)
  return (Math.abs(scaled - nearest) < 1e-9 ? nearest : Math.ceil(scaled)) / factor
}

function isFiniteEvidence(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
}

function isPositiveEvidence(value) {
  return isFiniteEvidence(value) && Number(value) > 0
}

function sameEvidenceNumber(left, right) {
  return isFiniteEvidence(left) && isFiniteEvidence(right) && Number(left) === Number(right)
}

export function validateCanonicalEntryProvenance(simulation = {}) {
  const realism = simulation.executionRealism ?? {}
  const recommendation = validateCurrentMarketEvidenceBundle(realism.recommendationEvidence, {
    now: realism.chronology?.decisionAt,
    maxAgeMs: 5 * 60 * 1000,
  })
  const quote = validateCurrentMarketEvidence(realism.quoteEvidence, {
    now: realism.chronology?.submittedAt,
    maxAgeMs: EXECUTION_QUOTE_MAX_AGE_MS,
  })
  const reasons = [
    ...recommendation.reasons.map((reason) => `recommendation:${reason}`),
    ...quote.reasons.map((reason) => `execution_quote:${reason}`),
  ]
  if (simulation.currentMarketEvidenceFingerprint !== recommendation.fingerprint) reasons.push('recommendation:simulation_fingerprint_mismatch')
  if (realism.recommendationEvidenceFingerprint !== recommendation.fingerprint) reasons.push('recommendation:realism_fingerprint_mismatch')
  if (realism.quoteEvidenceFingerprint !== currentMarketEvidenceFingerprint(realism.quoteEvidence)) reasons.push('execution_quote:fingerprint_mismatch')
  if (String(realism.quoteEvidence?.symbol ?? '').toUpperCase() !== String(simulation.symbol ?? '').toUpperCase()) reasons.push('execution_quote:symbol_mismatch')
  return { valid: reasons.length === 0, reasons: [...new Set(reasons)], recommendation, quote }
}

export function calculateCanonicalSignedMarkedValue(positions = []) {
  return round(positions.reduce((total, position) => {
    const multiplier = finite(getAssetProfile(position.assetType).contractMultiplier, 1)
    const value = finite(position.quantity) * finite(position.currentPrice) * multiplier
    return total + (position.side === 'short' ? -value : value)
  }, 0))
}

function markKey(position = {}) {
  return position.positionId ?? `${position.symbol}:${position.assetType}:${position.side}`
}

function normalizeMarks(marks = []) {
  const map = new Map()
  for (const mark of Array.isArray(marks) ? marks : Object.values(marks ?? {})) {
    const symbol = String(mark?.symbol ?? '').trim().toUpperCase()
    const positionId = String(mark?.positionId ?? '').trim()
    if (symbol) map.set(symbol, mark)
    if (positionId) map.set(positionId, mark)
  }
  return map
}

function hasKnownOpenRisk(position = {}) {
  const value = position.riskState?.openRisk
  return position.riskState?.version === CANONICAL_RISK_COMMITMENT_VERSION
    && position.riskState?.status === 'KNOWN'
    && value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0
}

function canonicalPortfolioState(account, positions, { marks = [], now = new Date().toISOString(), requireKnownRisk = false } = {}) {
  const suppliedMarks = normalizeMarks(marks)
  const markedPositions = positions.map((position) => {
    const supplied = suppliedMarks.get(position.positionId) ?? suppliedMarks.get(position.symbol)
    const price = Number(supplied?.price ?? supplied?.last ?? position.currentPrice)
    const observedAt = supplied?.updatedAt ?? supplied?.timestamp ?? position.markEvidenceTimestamp
    const age = Date.parse(now) - Date.parse(observedAt)
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(age) || age < 0 || age > DEFAULT_PAPER_EXIT_CONFIG.maxPriceAgeMs) {
      throw ledgerError(PAPER_LEDGER_ERRORS.marksUnavailable, `A current authoritative mark is required for ${markKey(position)}.`, 409, 'canonical paper position marks are missing or stale')
    }
    return { ...position, currentPrice: price, markEvidenceTimestamp: observedAt }
  })
  const unknownRisk = markedPositions.filter((position) => !hasKnownOpenRisk(position))
  if (requireKnownRisk && unknownRisk.length) {
    throw ledgerError(PAPER_LEDGER_ERRORS.riskUnknown, `Canonical open risk is unknown for ${unknownRisk.map(markKey).join(', ')}.`, 409, 'canonical paper risk state is unknown')
  }
  const signedMarkedValue = calculateCanonicalSignedMarkedValue(markedPositions)
  const equity = round(account.cash + signedMarkedValue)
  const reconciledAccount = { ...account, storedEquity: account.equity, equity }
  const evaluatedRisk = evaluatePortfolioRisk({
    id: account.accountId,
    cash: account.cash,
    equity,
    buyingPower: account.buyingPower,
    positions: markedPositions.map((position) => ({ ...position, dollarRisk: position.riskState?.openRisk })),
  }, { emitEvent: false, timestamp: now })
  const risk = unknownRisk.length ? {
    ...evaluatedRisk,
    state: 'UNKNOWN',
    summary: { ...evaluatedRisk.summary, openRisk: null, openRiskPct: null },
    warnings: [...evaluatedRisk.warnings, 'Canonical open risk is unknown for one or more positions'],
  } : { ...evaluatedRisk, state: 'KNOWN' }
  return {
    account: reconciledAccount,
    positions: markedPositions,
    risk,
    riskState: { status: unknownRisk.length ? 'UNKNOWN' : 'KNOWN', unknownPositionIds: unknownRisk.map((position) => position.positionId) },
    valuation: { status: 'RECONCILED', cash: round(account.cash), signedMarkedValue, equity, accountRevision: account.revision, markedAt: now },
  }
}

function deterministicStopExitCost(fill, stopPrice, timestamp) {
  const side = fill.side === 'buy' ? 'sell' : 'cover'
  const execution = simulateTradeExecution({
    approved: true,
    decision: 'approved',
    portfolioId: 'canonical-paper-risk',
    proposedTrade: {
      symbol: fill.symbol,
      assetType: fill.assetType,
      side,
      orderType: 'market',
      quantity: Number(fill.quantity),
      price: Number(stopPrice),
      stopPrice: Number(stopPrice),
      paperTrading: true,
    },
  }, {
    last: Number(stopPrice),
    bid: Number(stopPrice),
    ask: Number(stopPrice),
    high: Number(stopPrice),
    low: Number(stopPrice),
    timestamp,
  }, { emitEvent: false, timestamp })
  const stopFill = execution.fill
  const multiplier = getAssetProfile(fill.assetType).contractMultiplier
  if (execution.finalStatus !== 'filled' || !stopFill || !isPositiveEvidence(stopFill.fillPrice)
    || !isFiniteEvidence(stopFill.fees) || Number(stopFill.fees) < 0 || !isFiniteEvidence(stopFill.slippageAmount)) {
    throw ledgerError(PAPER_LEDGER_ERRORS.riskUnknown, 'Deterministic PAPER stop-exit costs could not be qualified.', 409, 'canonical paper risk state is unknown')
  }
  const slippageCost = roundRiskUp(Math.abs(Number(stopFill.fillPrice) - Number(stopPrice)) * Number(fill.quantity) * Number(multiplier))
  const exitFee = roundRiskUp(stopFill.fees)
  return {
    version: 'canonical-paper-stop-exit-cost-v1',
    status: 'QUALIFIED_BASE_WITH_UNQUALIFIED_FUTURE_COMPONENTS',
    feeModel: 'executionSimulationEngine.defaultFeeModel',
    slippageModel: 'executionSimulationEngine.defaultSlippageModel.market',
    deterministic: {
      referencePrice: Number(stopPrice),
      simulatedFillPrice: Number(stopFill.fillPrice),
      slippageCost,
      exitFee,
      total: roundRiskUp(slippageCost + exitFee),
    },
    unqualifiedComponents: UNQUALIFIED_EXIT_COST_COMPONENTS,
  }
}

function entryRiskState(canonicalRiskDecision, existingPosition, exitCostTreatment) {
  const proposedRisk = Number(canonicalRiskDecision?.metrics?.dollarRisk)
  if (!Number.isFinite(proposedRisk) || proposedRisk < 0) {
    throw ledgerError(PAPER_LEDGER_ERRORS.riskUnknown, 'The admitted entry does not contain a deterministic dollar-risk result.', 409, 'canonical paper risk state is unknown')
  }
  const existingRisk = existingPosition ? Number(existingPosition.riskState?.openRisk) : 0
  if (existingPosition && !hasKnownOpenRisk(existingPosition)) {
    throw ledgerError(PAPER_LEDGER_ERRORS.riskUnknown, `Canonical open risk is unknown for ${markKey(existingPosition)}.`, 409, 'canonical paper risk state is unknown')
  }
  const existingComponents = existingPosition?.riskState?.components ?? {}
  const metrics = canonicalRiskDecision.metrics
  return {
    version: CANONICAL_RISK_COMMITMENT_VERSION,
    status: 'KNOWN',
    openRisk: roundRiskUp(existingRisk + proposedRisk),
    source: 'canonical_fill_to_deterministic_stop_exit_risk',
    components: {
      fillToStop: roundRiskUp(finite(existingComponents.fillToStop) + metrics.priceRisk),
      entryFees: roundRiskUp(finite(existingComponents.entryFees) + metrics.entryCosts),
      deterministicExitSlippage: roundRiskUp(finite(existingComponents.deterministicExitSlippage) + exitCostTreatment.deterministic.slippageCost),
      deterministicExitFees: roundRiskUp(finite(existingComponents.deterministicExitFees) + exitCostTreatment.deterministic.exitFee),
    },
    unqualifiedComponents: UNQUALIFIED_EXIT_COST_COMPONENTS,
  }
}

function reducedRiskState(position, remainingQuantity) {
  const openRisk = Number(position.riskState?.openRisk)
  if (!hasKnownOpenRisk(position)) return { status: 'UNKNOWN', openRisk: null, source: 'missing_canonical_entry_risk' }
  const currentQuantity = Number(position.quantity)
  const remaining = Number(remainingQuantity)
  if (!Number.isFinite(currentQuantity) || currentQuantity <= 0 || !Number.isFinite(remaining) || remaining < 0 || remaining > currentQuantity) {
    return { status: 'UNKNOWN', openRisk: null, source: 'unsupported_reduction_evidence' }
  }
  if (remaining === 0) return { version: CANONICAL_RISK_COMMITMENT_VERSION, status: 'KNOWN', openRisk: 0, source: 'durable_full_close', components: { fillToStop: 0, entryFees: 0, deterministicExitSlippage: 0, deterministicExitFees: 0 }, unqualifiedComponents: [] }
  const ratio = remaining / currentQuantity
  const components = position.riskState?.components ?? {}
  return {
    version: CANONICAL_RISK_COMMITMENT_VERSION,
    status: 'KNOWN',
    openRisk: roundRiskUp(openRisk * ratio),
    source: 'proportional_exit_reduction',
    components: Object.fromEntries(Object.entries(components).map(([key, value]) => [key, roundRiskUp(Number(value) * ratio)])),
    unqualifiedComponents: position.riskState?.unqualifiedComponents ?? UNQUALIFIED_EXIT_COST_COMPONENTS,
  }
}

function immutableAttribution({ simulation = {}, forwardObservation = null, exitPolicy = null } = {}) {
  const observation = forwardObservation ?? simulation.forwardObservation ?? null
  return {
    strategyFingerprint: simulation.strategyFingerprint ?? simulation.qualifiedTradePlan?.integrity?.strategyFingerprint ?? exitPolicy?.strategyFingerprint ?? null,
    policyFingerprint: simulation.policyFingerprint ?? simulation.qualifiedTradePlan?.integrity?.policyFingerprint ?? exitPolicy?.definitionFingerprint ?? null,
    evaluationFingerprint: simulation.evaluationEvidenceFingerprint ?? simulation.qualifiedTradePlan?.integrity?.evidenceFingerprint ?? null,
    experimentId: observation?.experimentId ?? simulation.experimentId ?? simulation.qualifiedTradePlan?.integrity?.experimentId ?? null,
    observationId: observation?.observationId ?? null,
    manifestFingerprint: observation?.manifestFingerprint ?? null,
  }
}

function aggregateAttribution(values = []) {
  if (!values.length) return null
  const shared = (key) => {
    const unique = [...new Set(values.map((value) => value?.[key] ?? null))]
    return unique.length === 1 ? unique[0] : undefined
  }
  const strategyFingerprint = shared('strategyFingerprint')
  const policyFingerprint = shared('policyFingerprint')
  const experimentId = shared('experimentId')
  const observationId = shared('observationId')
  const manifestFingerprint = shared('manifestFingerprint')
  if ([strategyFingerprint, policyFingerprint, experimentId, observationId, manifestFingerprint].some((value) => value === undefined)) return null
  return {
    strategyFingerprint,
    policyFingerprint,
    evaluationFingerprints: [...new Set(values.flatMap((value) => value?.evaluationFingerprints ?? [value?.evaluationFingerprint]).filter(Boolean))],
    experimentId,
    observationId,
    manifestFingerprint,
  }
}

function activeLifecycleRows(rows = []) {
  let start = 0
  for (let index = 0; index < rows.length; index += 1) {
    const type = rows[index].execution_type ?? rows[index].payload?.executionType
    if (type === 'close') start = index + 1
  }
  return rows.slice(start)
}

function allocatedEntryFee(rows, requestedQuantity, remainingQuantity) {
  const lifecycle = activeLifecycleRows(rows)
  const entries = lifecycle.filter((row) => (row.execution_type ?? row.payload?.executionType) === 'entry')
  const reductions = lifecycle.filter((row) => (row.execution_type ?? row.payload?.executionType) === 'reduction')
  const entryFees = entries.reduce((sum, row) => sum + finite(row.fees ?? row.payload?.fees), 0)
  const alreadyAllocated = reductions.reduce((sum, row) => sum + finite(row.payload?.entryFeeAllocation), 0)
  const unallocated = Math.max(0, round(entryFees - alreadyAllocated))
  if (requestedQuantity >= remainingQuantity) return unallocated
  return round(unallocated * (requestedQuantity / remainingQuantity))
}

async function persistUnchangedMarks(client, positions, excludedPositionId) {
  for (const position of positions) {
    if (position.positionId === excludedPositionId) continue
    const write = await client.query(
      `UPDATE atlas_paper_positions SET current_price=$2,mark_evidence_timestamp=$3,revision=revision+1,updated_at=NOW()
       WHERE id=$1 AND revision=$4 RETURNING *`,
      [position.positionId, position.currentPrice, position.markEvidenceTimestamp, position.revision],
    )
    if (!write.rows?.[0]) throw ledgerError(PAPER_LEDGER_ERRORS.conflict, 'Paper position revision changed while persisting canonical marks.', 409, 'paper account state changed; retry evaluation')
  }
}

async function verifyEntryEvidence(client, scope, simulation) {
  const evaluation = await client.query(
    `SELECT id FROM atlas_ai_opportunity_analysis_history
     WHERE organization_id=$1 AND COALESCE(team_workspace_id,'')=$2 AND account_id=$3 AND user_id=$4
       AND analysis_category='paper_evaluation'
       AND payload->'paperEvaluation'->>'evaluationId'=$5
       AND context_fingerprint=$6
       AND payload->'paperEvaluation'->>'currentMarketEvidenceFingerprint'=$7
     LIMIT 1`,
    [scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId, simulation.evaluationId, simulation.evaluationEvidenceFingerprint, simulation.currentMarketEvidenceFingerprint],
  )
  const intent = await client.query(
    `SELECT id FROM atlas_ai_opportunity_analysis_history
     WHERE organization_id=$1 AND COALESCE(team_workspace_id,'')=$2 AND account_id=$3 AND user_id=$4
       AND analysis_category='paper_simulation' AND context_fingerprint=$5
       AND payload->'paperSimulation'->>'currentMarketEvidenceFingerprint'=$6
       AND payload->'paperSimulation'->'executionRealism'->>'recommendationEvidenceFingerprint'=$6
       AND payload->'paperSimulation'->'executionRealism'->>'quoteEvidenceFingerprint'=$7
     LIMIT 1`,
    [scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId, simulation.fingerprint, simulation.currentMarketEvidenceFingerprint, simulation.executionRealism?.quoteEvidenceFingerprint],
  )
  if (!evaluation.rows?.[0] || !intent.rows?.[0]) {
    throw ledgerError(PAPER_LEDGER_ERRORS.evidenceMissing, 'Durable PA.1 evaluation or PA.2 intent linkage is missing.', 409, 'durable paper evidence linkage is missing')
  }
  return { evaluationRecordId: evaluation.rows[0].id, intentRecordId: intent.rows[0].id }
}

export function resolveCanonicalPaperLedgerRepository({ persistenceRepository, ledgerRepository, env = process.env } = {}) {
  if (ledgerRepository) {
    if (ledgerRepository.persistenceMode === 'memory' && env.NODE_ENV === 'production') {
      throw ledgerError(PAPER_LEDGER_ERRORS.unavailable, 'Process-memory paper ledger is prohibited in production.')
    }
    return ledgerRepository
  }
  if (persistenceRepository?.connected !== true || typeof persistenceRepository.query !== 'function' || typeof persistenceRepository.transaction !== 'function') {
    throw ledgerError(PAPER_LEDGER_ERRORS.unavailable, 'Canonical PostgreSQL paper ledger is not connected.')
  }
  return createCanonicalPaperLedgerRepository({ database: persistenceRepository })
}

export function createCanonicalPaperLedgerRepository({ database, initialBalance = DEFAULT_INITIAL_PAPER_BALANCE, exitEvidenceSource, exitEvidenceQualification, exitEvidenceClock } = {}) {
  const evidenceService = createExitEvidenceService({ source: exitEvidenceSource, qualification: exitEvidenceQualification, clock: exitEvidenceClock })
  if (!database?.connected || typeof database.query !== 'function' || typeof database.transaction !== 'function') {
    throw ledgerError(PAPER_LEDGER_ERRORS.unavailable, 'Canonical PostgreSQL paper ledger is not connected.')
  }
  if (!Number.isFinite(Number(initialBalance)) || Number(initialBalance) <= 0) {
    throw ledgerError(PAPER_LEDGER_ERRORS.inconsistent, 'Canonical PAPER opening funding must be a positive server-configured amount.')
  }

  async function changeRiskLatch(action, input = {}) {
    const scope = normalizedScope(input)
    const actor = assertAuthenticatedHumanActor(input.actor, scope)
    const reason = requireLatchReason(input.reason)
    if (input.confirmed !== true) {
      throw ledgerError(PAPER_LEDGER_ERRORS.riskLatchResetDenied, 'Explicit human confirmation is required for a PAPER risk latch action.', 400, 'paper risk latch confirmation is required')
    }
    return database.transaction(async (client) => {
      const account = await ensureAccount(client, scope, initialBalance, { lock: true })
      const current = await loadRiskLatch(client, account, scope, { lock: true, allowMissing: action === 'KILL' })
      if (action === 'RESET') {
        const expectedRevision = Number(input.expectedRevision)
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || current?.state !== 'BLOCKED' || current.revision !== expectedRevision) {
          throw ledgerError(PAPER_LEDGER_ERRORS.riskLatchConflict, 'PAPER risk latch reset requires the current blocked revision.', 409, 'paper risk latch changed; review and retry')
        }
      }
      const previousState = current?.state ?? 'MISSING'
      const nextState = action === 'KILL' ? 'BLOCKED' : 'CLEAR'
      const nextRevision = current ? current.revision + 1 : 0
      const latchWrite = current
        ? await client.query(
          `UPDATE atlas_paper_risk_latches
           SET latch_state=$2,reason=$3,changed_by_user_id=$4,changed_by_role=$5,revision=$6,updated_at=clock_timestamp()
           WHERE account_record_id=$1 AND revision=$7 RETURNING *`,
          [account.recordId, nextState, reason, actor.userId, actor.role, nextRevision, current.revision],
        )
        : await client.query(
          `INSERT INTO atlas_paper_risk_latches
            (account_record_id,organization_id,team_workspace_id,account_id,user_id,latch_state,reason,changed_by_user_id,changed_by_role,revision,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,'BLOCKED',$6,$7,$8,0,NOW(),NOW()) RETURNING *`,
          [account.recordId, scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId, reason, actor.userId, actor.role],
        )
      if (!latchWrite.rows?.[0]) {
        throw ledgerError(PAPER_LEDGER_ERRORS.riskLatchConflict, 'PAPER risk latch revision changed during the action.', 409, 'paper risk latch changed; review and retry')
      }
      const latch = riskLatchFromRow(latchWrite.rows[0])
      if (!latch) throw ledgerError(PAPER_LEDGER_ERRORS.riskLatchUnavailable, 'Written PAPER risk latch state is unreadable.', 503, 'paper risk latch is unavailable')
      const auditId = `paper-risk-latch-audit-${randomUUID()}`
      const evidence = {
        version: 'paper-risk-latch-v1',
        action,
        previousState,
        nextState,
        reason,
        actor: { userId: actor.userId, role: actor.role, source: 'authenticated_human_request' },
        scope: { organizationId: scope.organizationId, teamWorkspaceId: scope.teamWorkspaceId, accountId: scope.accountId, userId: scope.userId },
        accountRevision: account.revision,
        latchRevision: latch.revision,
        paperTradingOnly: true,
        liveOrders: false,
        brokerExecution: false,
      }
      const auditWrite = await client.query(
        `INSERT INTO atlas_paper_risk_latch_audit
          (id,account_record_id,organization_id,team_workspace_id,account_id,user_id,action,previous_state,next_state,reason,actor_user_id,actor_role,latch_revision,evidence,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,clock_timestamp()) RETURNING *`,
        [auditId, account.recordId, scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId, action, previousState, nextState, reason, actor.userId, actor.role, latch.revision, evidence],
      )
      if (!auditWrite.rows?.[0]) throw ledgerError(PAPER_LEDGER_ERRORS.riskLatchUnavailable, 'PAPER risk latch audit could not be persisted.', 503, 'paper risk latch audit is unavailable')
      return { ok: true, action, account, latch, audit: { id: auditId, ...evidence }, paperTradingOnly: true, liveOrders: false, brokerExecution: false }
    })
  }

  return {
    connected: true,
    persistenceMode: 'postgresql',

    activateRiskLatch(input = {}) {
      return changeRiskLatch('KILL', input)
    },

    resetRiskLatch(input = {}) {
      return changeRiskLatch('RESET', input)
    },

    // Advisory reads must never initialize an account or persist marks.
    async readAccountSnapshot(input = {}) {
      const scope = normalizedScope(input)
      const result = await database.query(
        `SELECT a.*, COALESCE((
           SELECT json_agg(p ORDER BY p.symbol, p.asset_type, p.side)
           FROM atlas_paper_positions p
           WHERE p.account_record_id=a.id AND p.status='open' AND p.quantity>0
         ), '[]'::json) AS snapshot_positions
         FROM atlas_paper_accounts a
         WHERE a.organization_id=$1 AND a.team_workspace_id=$2 AND a.account_id=$3 AND a.user_id=$4`,
        [scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId],
      )
      if (!result.rows?.[0]) return { account: null, positions: null }
      const account = accountFromRow(result.rows[0])
      return { account, positions: (result.rows[0].snapshot_positions ?? []).map(positionFromRow) }
    },

    async getOrCreateAccount(input = {}) {
      const scope = normalizedScope(input)
      return database.transaction(async (client) => {
        const account = await ensureAccount(client, scope, initialBalance)
        const positions = await loadPositions(client, account.recordId)
        return { account, positions }
      })
    },

    async getCanonicalState(input = {}) {
      const scope = normalizedScope(input)
      return database.transaction(async (client) => {
        const account = await ensureAccount(client, scope, initialBalance, { lock: true })
        const positions = await loadPositions(client, account.recordId, { lock: true })
        return canonicalPortfolioState(account, positions, {
          marks: input.marks,
          now: input.now,
          requireKnownRisk: input.requireKnownRisk === true,
        })
      })
    },

    async listOpenPositions(input = {}) {
      const { account, positions } = await this.getOrCreateAccount(input)
      return positions.map((position) => ({ ...position, accountId: account.accountId }))
    },

    async readExecutionHistory(input = {}) {
      const scope = normalizedScope(input)
      const requestedLimit = Number.isInteger(Number(input.limit)) && Number(input.limit) > 0 ? Math.min(500, Number(input.limit)) : null
      const queryLimit = requestedLimit == null ? null : requestedLimit + 1
      const result = await database.query(
        requestedLimit == null
          ? `SELECT * FROM atlas_paper_executions
             WHERE organization_id=$1 AND team_workspace_id=$2 AND account_id=$3 AND user_id=$4
             ORDER BY created_at ASC, id ASC`
          : `SELECT * FROM (
               SELECT * FROM atlas_paper_executions
               WHERE organization_id=$1 AND team_workspace_id=$2 AND account_id=$3 AND user_id=$4
               ORDER BY created_at DESC, id DESC LIMIT $5
             ) latest ORDER BY created_at ASC, id ASC`,
        requestedLimit == null
          ? [scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId]
          : [scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId, queryLimit],
      )
      const mapped = (result.rows ?? []).map(executionFromRow)
      const windowed = requestedLimit != null && mapped.length > requestedLimit
      const executions = windowed ? mapped.slice(-requestedLimit) : mapped
      return {
        executions,
        history: {
          status: windowed ? 'WINDOWED' : 'COMPLETE',
          returnedCount: executions.length,
          limit: requestedLimit,
          hasEarlier: windowed,
          latest: true,
        },
      }
    },

    async listExecutions(input = {}) {
      return (await this.readExecutionHistory(input)).executions
    },

    async listForwardObservationExecutions(input = {}) {
      const scope = normalizedScope(input)
      const result = await database.query(
        `SELECT * FROM atlas_paper_executions
         WHERE organization_id=$1 AND team_workspace_id=$2 AND account_id=$3 AND user_id=$4
           AND execution_type='close' AND payload->'forwardObservation'->>'experimentId' IS NOT NULL
         ORDER BY created_at ASC,id ASC`,
        [scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId],
      )
      return (result.rows ?? []).map(executionFromRow)
    },

    async commitEntry(input = {}) {
      const scope = normalizedScope(input)
      const simulation = input.simulation ?? {}
      const fill = simulation.executionFill
      const realism = simulation.executionRealism ?? {}
      const fillEvidence = realism.fillEvidence ?? {}
      const executableSidePrice = fill?.side === 'buy' || fill?.side === 'cover' ? realism.quoteEvidence?.ask : realism.quoteEvidence?.bid
      const assetType = String(fill?.assetType ?? '').trim().toLowerCase()
      const assetProfile = SUPPORTED_ASSET_TYPES.includes(assetType) ? getAssetProfile(assetType) : null
      const provenance = validateCanonicalEntryProvenance(simulation)
      const stopPrice = simulation.orderPlan?.stopReference
      const openingSide = fill?.side === 'buy' || fill?.side === 'short'
      const fillInputsValid = openingSide
        && simulation.orderPlan?.side === fill.side
        && String(fill.symbol ?? '').trim().toUpperCase() === String(simulation.symbol ?? '').trim().toUpperCase()
        && isPositiveEvidence(fill.quantity)
        && isPositiveEvidence(fill.referencePrice)
        && isPositiveEvidence(fill.fillPrice)
        && isFiniteEvidence(fill.fees) && Number(fill.fees) >= 0
        && isFiniteEvidence(fill.slippageBps) && Number(fill.slippageBps) >= 0
        && isFiniteEvidence(fill.cashImpact)
        && isPositiveEvidence(stopPrice)
        && (fill.side === 'buy' ? Number(stopPrice) < Number(fill.fillPrice) : Number(stopPrice) > Number(fill.fillPrice))
        && assetProfile !== null
        && isPositiveEvidence(assetProfile.contractMultiplier)
      const realismValid = simulation.engineVersion === 'guarded-paper-simulation-v3'
        && simulation.executionCalibrationStatus === 'PAPER_ONLY_NOT_LIVE_CALIBRATED'
        && realism.version === 'paper-execution-realism-v2'
        && realism.paperSimulationAdmissibility?.status === 'ADMISSIBLE'
        && realism.liveExecutionCalibration?.status === 'NOT_CALIBRATED'
        && realism.liveExecutionCalibration?.liveMoneyReady === false
        && provenance.valid
        && realism.quantityEvidence?.fullQuantityDisplayed === true
        && isPositiveEvidence(realism.quantityEvidence?.displayedSize)
        && Number(realism.quantityEvidence.displayedSize) >= Number(fill?.quantity)
        && sameEvidenceNumber(fillEvidence.filledQuantity, fill?.quantity)
        && sameEvidenceNumber(fillEvidence.referencePrice, fill?.referencePrice)
        && sameEvidenceNumber(fillEvidence.fillPrice, fill?.fillPrice)
        && sameEvidenceNumber(fillEvidence.slippageBps, fill?.slippageBps)
        && sameEvidenceNumber(fillEvidence.fees, fill?.fees)
        && sameEvidenceNumber(executableSidePrice, fill?.referencePrice)
        && fillEvidence.costApplications?.spread === 1
        && fillEvidence.costApplications?.slippage === 1
        && fillEvidence.costApplications?.fees === 1
      if (simulation.status !== 'SIMULATED_FILLED' || !simulation.fingerprint || !simulation.evaluationId || !simulation.evaluationEvidenceFingerprint || !fill || !fillInputsValid || !realismValid) {
        const provenanceDetail = provenance.valid ? '' : ` Provenance rejected: ${provenance.reasons.join(', ')}.`
        throw ledgerError(PAPER_LEDGER_ERRORS.evidenceMissing, `A filled PA.2 result with durable evidence and fill linkage is required.${provenanceDetail}`, 409, 'durable paper evidence linkage is missing')
      }
      const exitCostTreatment = deterministicStopExitCost(fill, stopPrice, simulation.simulatedAt)
      return database.transaction(async (client) => {
        const account = await ensureAccount(client, scope, initialBalance, { lock: true })
        const riskLatch = await loadRiskLatch(client, account, scope, { lock: true })
        if (riskLatch.state !== 'CLEAR') {
          throw ledgerError(PAPER_LEDGER_ERRORS.riskLatchBlocked, `Durable PAPER risk latch is ${riskLatch.state} at revision ${riskLatch.revision}.`, 409, 'paper risk latch is blocked')
        }
        const prior = await client.query('SELECT * FROM atlas_paper_executions WHERE account_record_id=$1 AND idempotency_fingerprint=$2', [account.recordId, simulation.fingerprint])
        if (prior.rows?.[0]) return { ok: true, duplicate: true, execution: executionFromRow(prior.rows[0]), account }
        const evidence = await verifyEntryEvidence(client, scope, simulation)
        const positions = await loadPositions(client, account.recordId, { lock: true })
        const decisionAt = input.now ?? simulation.simulatedAt ?? new Date().toISOString()
        const canonical = canonicalPortfolioState(account, positions, { marks: input.marks, now: decisionAt, requireKnownRisk: true })
        const proposedTrade = {
          symbol: simulation.symbol,
          assetType: fill.assetType,
          side: simulation.orderPlan?.side ?? fill.side,
          orderType: simulation.orderPlan?.entryType ?? 'market',
          quantity: fill.quantity,
          price: fill.fillPrice,
          stopPrice,
          entryCosts: fill.fees,
          exitCosts: exitCostTreatment.deterministic.total,
          paperTrading: true,
        }
        const canonicalRiskDecision = evaluateTradeGuardrail({
          id: scope.accountId,
          cash: canonical.account.cash,
          equity: canonical.account.equity,
          buyingPower: canonical.account.buyingPower,
          positions: canonical.positions,
        }, proposedTrade, { emitEvent: false, currentRisk: canonical.risk, timestamp: decisionAt })
        if (!canonicalRiskDecision.approved) {
          throw ledgerError(PAPER_LEDGER_ERRORS.conflict, `Canonical risk admission rejected the entry: ${canonicalRiskDecision.reason}`, 409, 'canonical paper risk admission rejected the entry')
        }
        const accounting = applyPaperPortfolioAccounting({ id: scope.accountId, cash: canonical.account.cash, equity: canonical.account.equity, realizedPnl: canonical.account.realizedPnl, positions: canonical.positions }, { finalStatus: 'filled', fill }, { emitEvent: false, timestamp: simulation.simulatedAt })
        if (accounting.status === 'rejected' || accounting.account.cash < 0) {
          throw ledgerError(PAPER_LEDGER_ERRORS.conflict, 'Durable account state no longer permits this entry.', 409, 'paper account state changed; retry evaluation')
        }
        const projected = accounting.positions.find((position) => position.symbol === simulation.symbol && position.assetType === normalizeAssetType(fill.assetType) && position.side === (fill.side === 'short' ? 'short' : 'long'))
        if (!projected) throw ledgerError(PAPER_LEDGER_ERRORS.inconsistent, 'Entry accounting did not produce a canonical position.')
        const existingPosition = canonical.positions.find((position) => position.symbol === projected.symbol && position.assetType === projected.assetType && position.side === projected.side)
        const riskState = entryRiskState(canonicalRiskDecision, existingPosition, exitCostTreatment)
        const positionId = await scopedId('paper-position', [account.recordId, projected.symbol, projected.assetType, projected.side])
        const executionId = await scopedId('paper-execution', [account.recordId, simulation.fingerprint])
        const payload = compactExecutionPayload({
          executionId, accountRecordId: account.recordId, accountId: scope.accountId, positionId,
          executionType: 'entry', fingerprint: simulation.fingerprint, candidateId: simulation.candidateId,
          entryChronology: { version: 'paper-entry-ledger-clock-v1', timeBasis: 'execution_created_at' },
          executionRealism: realism,
          executionCalibrationStatus: simulation.executionCalibrationStatus,
          exitCostTreatment,
          evaluationId: simulation.evaluationId, evaluationEvidenceFingerprint: simulation.evaluationEvidenceFingerprint,
          executionIntentFingerprint: simulation.fingerprint, strategyId: simulation.strategyId, symbol: simulation.symbol,
          assetType: fill.assetType, side: fill.side, quantity: fill.quantity, fillPrice: fill.fillPrice,
          fees: fill.fees, slippageBps: fill.slippageBps, cashImpact: fill.cashImpact, realizedPnlDelta: 0,
          accountingStatus: accounting.status, evidenceTimestamp: simulation.orderPlan?.evidenceTimestamp,
          engineVersion: simulation.engineVersion, journal: simulation.journal, tradeQuality: simulation.tradeQuality,
          regime: simulation.regime, evaluationStatus: simulation.evaluationStatus,
          exitPolicy: simulation.exitPolicy ?? simulation.orderPlan?.exitPolicy,
          forwardObservation: simulation.forwardObservation ?? null,
          accountRevision: account.revision,
          valuation: canonical.valuation,
          riskState,
          canonicalRiskDecision: {
            decision: canonicalRiskDecision.decision,
            checks: canonicalRiskDecision.checks,
            metrics: canonicalRiskDecision.metrics,
          },
          plannedRisk: round(canonicalRiskDecision.metrics.dollarRisk),
          attribution: immutableAttribution({ simulation, forwardObservation: simulation.forwardObservation, exitPolicy: simulation.exitPolicy ?? simulation.orderPlan?.exitPolicy }),
          accountCashAfter: accounting.account.cash,
          accountEquityAfter: accounting.account.equity,
          accountRealizedPnlAfter: accounting.account.realizedPnl,
          evidence,
        })
        const inserted = await client.query(
          `INSERT INTO atlas_paper_executions
            (id,account_record_id,organization_id,team_workspace_id,account_id,user_id,position_id,execution_type,idempotency_fingerprint,candidate_id,evaluation_id,execution_intent_id,strategy_id,symbol,asset_type,side,quantity,fill_price,fees,slippage_bps,cash_impact,realized_pnl_delta,evidence_timestamp,engine_version,payload,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'entry',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,0,$21,$22,$23,clock_timestamp())
           ON CONFLICT (account_record_id,idempotency_fingerprint) DO NOTHING RETURNING *`,
          [executionId, account.recordId, scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId, positionId, simulation.fingerprint, simulation.candidateId, simulation.evaluationId, evidence.intentRecordId, simulation.strategyId, simulation.symbol, fill.assetType, fill.side, fill.quantity, fill.fillPrice, fill.fees, fill.slippageBps, fill.cashImpact, simulation.orderPlan?.evidenceTimestamp ?? simulation.simulatedAt, simulation.engineVersion, payload],
        )
        if (!inserted.rows?.[0]) throw ledgerError(PAPER_LEDGER_ERRORS.conflict, 'Paper execution intent changed during entry.', 409, 'paper account state changed; retry evaluation')
        await persistUnchangedMarks(client, canonical.positions, existingPosition?.positionId)
        const buyingPower = Math.max(0, account.buyingPower + finite(fill.cashImpact))
        const accountWrite = await client.query(
          `UPDATE atlas_paper_accounts SET cash=$2,buying_power=$3,equity=$4,realized_pnl=$5,revision=revision+1,updated_at=NOW()
           WHERE id=$1 AND revision=$6 RETURNING *`,
          [account.recordId, accounting.account.cash, buyingPower, accounting.account.equity, accounting.account.realizedPnl, account.revision],
        )
        if (!accountWrite.rows?.[0]) throw ledgerError(PAPER_LEDGER_ERRORS.conflict, 'Paper account revision changed during entry.', 409, 'paper account state changed; retry evaluation')
        await appendExecutionAccountingEvidence(client, { accountBefore: account, accountAfter: accountWrite.rows[0], scope, execution: inserted.rows[0] })
        const positionWrite = await client.query(
          `INSERT INTO atlas_paper_positions
            (id,account_record_id,organization_id,team_workspace_id,account_id,user_id,symbol,asset_type,side,quantity,average_cost,current_price,mark_evidence_timestamp,risk_state,realized_pnl,originating_candidate_id,originating_evaluation_id,originating_intent_fingerprint,strategy_id,status,revision,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'open',0,NOW(),NOW())
           ON CONFLICT (account_record_id,symbol,asset_type,side) DO UPDATE SET quantity=EXCLUDED.quantity,average_cost=EXCLUDED.average_cost,current_price=EXCLUDED.current_price,mark_evidence_timestamp=EXCLUDED.mark_evidence_timestamp,risk_state=EXCLUDED.risk_state,originating_candidate_id=CASE WHEN atlas_paper_positions.status='closed' THEN EXCLUDED.originating_candidate_id ELSE atlas_paper_positions.originating_candidate_id END,originating_evaluation_id=CASE WHEN atlas_paper_positions.status='closed' THEN EXCLUDED.originating_evaluation_id ELSE atlas_paper_positions.originating_evaluation_id END,originating_intent_fingerprint=CASE WHEN atlas_paper_positions.status='closed' THEN EXCLUDED.originating_intent_fingerprint ELSE atlas_paper_positions.originating_intent_fingerprint END,strategy_id=EXCLUDED.strategy_id,status='open',revision=atlas_paper_positions.revision+1,updated_at=NOW()
           RETURNING *`,
          [positionId, account.recordId, scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId, projected.symbol, projected.assetType, projected.side, projected.quantity, projected.averagePrice, projected.currentPrice, simulation.orderPlan?.evidenceTimestamp ?? simulation.simulatedAt, riskState, projected.realizedPnl, simulation.candidateId, simulation.evaluationId, simulation.fingerprint, simulation.strategyId],
        )
        return { ok: true, duplicate: false, execution: executionFromRow(inserted.rows[0]), account: accountFromRow(accountWrite.rows[0]), position: positionFromRow(positionWrite.rows[0]), accounting, canonicalRiskDecision, valuation: canonical.valuation }
      })
    },

    async commitExit(input = {}) {
      const scope = normalizedScope(input)
      if (input.confirmed !== true) throw ledgerError(PAPER_LEDGER_ERRORS.evidenceMissing, 'Explicit human paper exit confirmation is required.', 400, 'explicit paper exit confirmation is required')
      if (!input.positionId) throw ledgerError(PAPER_LEDGER_ERRORS.inconsistent, 'A canonical position id is required.', 400, 'paper position is invalid')
      return database.transaction(async (client) => {
        const account = await ensureAccount(client, scope, initialBalance, { lock: true })
        const selected = await client.query(
          `SELECT * FROM atlas_paper_positions
           WHERE id=$1 AND account_record_id=$2 AND organization_id=$3 AND team_workspace_id=$4 AND account_id=$5 AND user_id=$6
           FOR UPDATE`,
          [input.positionId, account.recordId, scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId],
        )
        if (!selected.rows?.[0]) throw ledgerError(PAPER_LEDGER_ERRORS.inconsistent, 'Canonical paper position was not found.', 404, 'paper position was not found')
        let position = positionFromRow(selected.rows[0])
        const requestedQuantity = finite(input.quantity, NaN)
        const closingSide = position.side === 'short' ? 'cover' : 'sell'
        const fingerprint = createPaperExitFingerprint({ positionId: position.positionId, quantity: requestedQuantity, quote: input.quote, side: closingSide })
        const prior = await client.query('SELECT * FROM atlas_paper_executions WHERE account_record_id=$1 AND idempotency_fingerprint=$2', [account.recordId, fingerprint])
        if (prior.rows?.[0]) return { ok: true, duplicate: true, execution: executionFromRow(prior.rows[0]), result: prior.rows[0].payload?.paperResult }
        if (position.status !== 'open' || position.quantity <= 0) throw ledgerError(PAPER_LEDGER_ERRORS.conflict, 'Canonical paper position is already closed.', 409, 'paper position is already closed')
        const lifecycleRows = await client.query(
          `SELECT * FROM atlas_paper_executions WHERE account_record_id=$1 AND position_id=$2 ORDER BY created_at ASC,id ASC`,
          [account.recordId, position.positionId],
        )
        const activeRows = activeLifecycleRows(lifecycleRows.rows ?? [])
        const entryRows = activeRows.filter((row) => (row.execution_type ?? row.payload?.executionType) === 'entry')
        const entries = entryRows.map((row) => row.payload)
        const originatingEntry = entries.find((entry) => entry.executionIntentFingerprint === position.originatingIntentFingerprint)
        const exitPolicy = originatingEntry?.exitPolicy ?? entries.find((entry) => entry.exitPolicy)?.exitPolicy ?? null
        const policyRequired = Boolean(exitPolicy || entries.some((entry) => entry.forwardObservation)
          || position.strategyId === 'index-pullback-v1' || !originatingEntry)
        // Only locked durable state reaches the server-owned retrieval boundary.
        // Multi-entry/reduced lifecycles need lot chronology; never guess a common entry.
        let exitEvidence = null
        if (policyRequired && input.exitReason !== 'manual_emergency') {
          const row = entryRows[0]
          const evidenceContext = {
            scope, position, policy: exitPolicy,
            entry: row ? { ...row.payload, executionId: row.id, positionId: row.position_id,
              executedAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at } : null,
          }
          if (exitPolicy && originatingEntry && entryRows.length === 1 && activeRows.length === 1
            && Number(row.quantity) === position.quantity) exitEvidence = await evidenceService.getExitEvidence(evidenceContext)
          if (!isExitEvidenceFor(exitEvidence, evidenceContext) || exitEvidence.manifest.evidenceClass !== 'GENUINE') return {
            ok: false, duplicate: false,
            result: {
              positionId: position.positionId, status: 'REJECTED', blockers: [POLICY_EXIT_EVIDENCE_BLOCKER],
              chronologyStatus: AUTHORITATIVE_CHRONOLOGY_UNAVAILABLE,
              chronologyReason: exitEvidence?.reason ?? 'non_genuine_or_unsupported_lifecycle',
              exitPolicy, exitAttribution: { policyCompliant: false, attribution: POLICY_EXIT_EVIDENCE_BLOCKER, countsTowardObservationMinimum: false },
              paperTradingOnly: true, automaticExecution: false, liveOrders: false, brokerExecution: false,
            },
          }
        }
        const lockedPositions = await loadPositions(client, account.recordId, { lock: true })
        const marks = [...(Array.isArray(input.marks) ? input.marks : Object.values(input.marks ?? {})), { symbol: position.symbol, positionId: position.positionId, ...input.quote }]
        const canonical = canonicalPortfolioState(account, lockedPositions, { marks, now: input.now })
        position = canonical.positions.find((item) => item.positionId === position.positionId)
        if (!position) throw ledgerError(PAPER_LEDGER_ERRORS.conflict, 'Canonical paper position changed during exit.', 409, 'paper account state changed; retry exit')
        const result = simulatePaperPositionExit({ position: { ...position, exitPolicy }, positions: canonical.positions, account: canonical.account, quantity: requestedQuantity, quote: input.quote, paperModeEnabled: input.paperModeEnabled === true, exitReason: input.exitReason, exitEvidence }, { now: input.now })
        if (result.exitAttribution?.policyCompliant === true) result.exitAttribution.evidenceManifestHash = exitEvidence.manifest.manifestHash
        if (input.exitReason === 'manual_emergency') result.exitAttribution = { policyCompliant: false, attribution: 'MANUAL_EMERGENCY_CLOSE', countsTowardObservationMinimum: false }
        if (!['POSITION_CLOSED', 'POSITION_REDUCED'].includes(result.status)) return { ok: false, duplicate: false, result }
        if (result.status === 'POSITION_REDUCED' && (!result.positionSnapshot || !isPositiveEvidence(result.exitPlan?.remainingQuantity))) {
          throw ledgerError(PAPER_LEDGER_ERRORS.riskUnknown, 'A partial reduction did not produce deterministic remaining exposure.', 409, 'canonical paper risk state is unknown')
        }
        const remainingRiskQuantity = result.status === 'POSITION_CLOSED' ? 0 : result.exitPlan.remainingQuantity
        const entryFeeAllocation = allocatedEntryFee(activeRows, requestedQuantity, position.quantity)
        result.exitPlan.entryFeeAllocation = entryFeeAllocation
        result.exitPlan.realizedPnlDelta = round(result.exitPlan.realizedPnlDelta - entryFeeAllocation)
        result.exitPlan.netPnl = result.exitPlan.realizedPnlDelta
        result.exitPlan.totalCosts = round(finite(result.exitPlan.fees) + entryFeeAllocation)
        result.accountSnapshot.realizedPnl = round(canonical.account.realizedPnl + result.exitPlan.realizedPnlDelta)
        if (result.positionSnapshot) result.positionSnapshot.realizedPnl = round(finite(result.positionSnapshot.realizedPnl) - entryFeeAllocation)
        if (result.journal) result.journal.realizedPnl = result.exitPlan.realizedPnlDelta
        const fill = {
          assetType: position.assetType, side: closingSide, quantity: requestedQuantity,
          fillPrice: result.exitPlan.simulatedExitPrice, fees: result.exitPlan.fees,
          slippageBps: result.exitPlan.slippageBps,
          cashImpact: result.accountSnapshot.cash - canonical.account.cash,
        }
        const executionType = result.status === 'POSITION_CLOSED' ? 'close' : 'reduction'
        const entryCohort = entries[0]?.forwardObservation
        const cohortKey = entryCohort?.experimentId ? JSON.stringify(entryCohort) : null
        const forwardObservation = cohortKey && entries.every((entry) =>
          JSON.stringify(entry.forwardObservation) === cohortKey
          && entry.exitPolicy?.fingerprint === result.exitPolicy?.fingerprint,
        ) ? entryCohort : null
        const entryAttributions = entries.map((entry) => entry.attribution ?? immutableAttribution({ simulation: entry, forwardObservation: entry.forwardObservation, exitPolicy: entry.exitPolicy }))
        const attribution = aggregateAttribution(entryAttributions)
        const executionId = await scopedId('paper-execution', [account.recordId, fingerprint])
        const payload = compactExecutionPayload({
          executionId, accountRecordId: account.recordId, accountId: scope.accountId,
          positionId: position.positionId, executionType, fingerprint,
          candidateId: position.originatingCandidateId, evaluationId: position.originatingEvaluationId,
          evaluationEvidenceFingerprint: originatingEntry?.evaluationEvidenceFingerprint,
          executionIntentFingerprint: position.originatingIntentFingerprint, strategyId: position.strategyId,
          symbol: position.symbol, assetType: position.assetType, side: closingSide, quantity: requestedQuantity,
          fillPrice: fill.fillPrice, fees: fill.fees, slippageBps: fill.slippageBps, cashImpact: fill.cashImpact,
          realizedPnlDelta: result.exitPlan.realizedPnlDelta, accountingStatus: executionType === 'close' ? 'position_closed' : 'position_reduced',
          evidenceTimestamp: result.exitPlan.evidenceTimestamp, engineVersion: result.engineVersion, journal: result.journal,
          tradeQuality: result.tradeQuality, regime: result.regime, evaluationStatus: result.evaluationStatus,
          exitPolicy: result.exitPolicy, exitAttribution: result.exitAttribution, exitEvidenceManifest: result.exitEvidenceManifest,
          forwardObservation,
          attribution,
          plannedRisk: entries.every((entry) => Number.isFinite(Number(entry.plannedRisk ?? entry.canonicalRiskDecision?.metrics?.dollarRisk)))
            ? round(entries.reduce((sum, entry) => sum + finite(entry.plannedRisk ?? entry.canonicalRiskDecision?.metrics?.dollarRisk), 0))
            : null,
          entryFeeAllocation,
          accountRevision: account.revision,
          valuation: canonical.valuation,
          accountCashAfter: result.accountSnapshot.cash,
          accountEquityAfter: result.accountSnapshot.equity,
          accountRealizedPnlAfter: result.accountSnapshot.realizedPnl,
          riskState: reducedRiskState(position, remainingRiskQuantity),
          entryEvidence: entries.map((entry) => ({
            executionId: entry.executionId, strategyId: entry.strategyId,
             evaluationId: entry.evaluationId, evaluationEvidenceFingerprint: entry.evaluationEvidenceFingerprint,
             executionIntentFingerprint: entry.executionIntentFingerprint,
             exitPolicy: entry.exitPolicy, forwardObservation: entry.forwardObservation,
             plannedRisk: entry.plannedRisk ?? entry.canonicalRiskDecision?.metrics?.dollarRisk ?? null,
             attribution: entry.attribution ?? null,
          })),
        })
        payload.paperResult = result
        const inserted = await client.query(
          `INSERT INTO atlas_paper_executions
            (id,account_record_id,organization_id,team_workspace_id,account_id,user_id,position_id,execution_type,idempotency_fingerprint,candidate_id,evaluation_id,execution_intent_id,strategy_id,symbol,asset_type,side,quantity,fill_price,fees,slippage_bps,cash_impact,realized_pnl_delta,evidence_timestamp,engine_version,payload,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,clock_timestamp())
           ON CONFLICT (account_record_id,idempotency_fingerprint) DO NOTHING RETURNING *`,
          [executionId, account.recordId, scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId, position.positionId, executionType, fingerprint, position.originatingCandidateId, position.originatingEvaluationId, position.originatingIntentFingerprint, position.strategyId, position.symbol, position.assetType, closingSide, requestedQuantity, fill.fillPrice, fill.fees, fill.slippageBps, fill.cashImpact, result.exitPlan.realizedPnlDelta, result.exitPlan.evidenceTimestamp, result.engineVersion, payload],
        )
        if (!inserted.rows?.[0]) {
          const existing = await client.query('SELECT * FROM atlas_paper_executions WHERE account_record_id=$1 AND idempotency_fingerprint=$2', [account.recordId, fingerprint])
          return { ok: true, duplicate: true, execution: executionFromRow(existing.rows[0]), result: existing.rows[0].payload?.paperResult }
        }
        await persistUnchangedMarks(client, canonical.positions, position.positionId)
        const accountWrite = await client.query(
          `UPDATE atlas_paper_accounts SET cash=$2,buying_power=$3,equity=$4,realized_pnl=$5,revision=revision+1,updated_at=NOW()
           WHERE id=$1 AND revision=$6 RETURNING *`,
          [account.recordId, result.accountSnapshot.cash, Math.max(0, account.buyingPower + fill.cashImpact), result.accountSnapshot.equity, result.accountSnapshot.realizedPnl, account.revision],
        )
        if (!accountWrite.rows?.[0]) throw ledgerError(PAPER_LEDGER_ERRORS.conflict, 'Paper account revision changed during exit.', 409, 'paper account state changed; retry exit')
        await appendExecutionAccountingEvidence(client, { accountBefore: account, accountAfter: accountWrite.rows[0], scope, execution: inserted.rows[0] })
        const remaining = result.positionSnapshot
        const riskState = reducedRiskState(position, remainingRiskQuantity)
        const positionWrite = await client.query(
          `UPDATE atlas_paper_positions SET quantity=$2,average_cost=$3,current_price=$4,mark_evidence_timestamp=$5,risk_state=$6,realized_pnl=realized_pnl+$7,status=$8,revision=revision+1,updated_at=NOW()
           WHERE id=$1 AND revision=$9 RETURNING *`,
          [position.positionId, remaining?.quantity ?? 0, remaining?.averagePrice ?? position.averagePrice, fill.fillPrice, result.exitPlan.evidenceTimestamp, riskState, result.exitPlan.realizedPnlDelta, remaining ? 'open' : 'closed', position.revision],
        )
        if (!positionWrite.rows?.[0]) throw ledgerError(PAPER_LEDGER_ERRORS.conflict, 'Paper position revision changed during exit.', 409, 'paper position state changed; retry exit')
        return { ok: true, duplicate: false, execution: executionFromRow(inserted.rows[0]), account: accountFromRow(accountWrite.rows[0]), position: positionFromRow(positionWrite.rows[0]), result, valuation: canonical.valuation }
      })
    },
  }
}
