import { createHash } from 'node:crypto'
import { simulateRealtimePaperExecution } from '../../trading/realTimeSimulatedExecutionCoordinator.js'
import { classifyObservationExit, evaluateIndexPullbackExitPolicy } from '../forwardTest/indexPullbackExitPolicy.js'
import { evaluateBreakoutMomentumExitPolicy } from '../forwardTest/breakoutMomentumExitPolicy.js'
import { evaluateRangeMeanReversionExitPolicy } from '../forwardTest/rangeMeanReversionExitPolicy.js'
import { evaluateVolatilityExpansionExitPolicy } from '../forwardTest/volatilityExpansionExitPolicy.js'
import { DEFAULT_PAPER_EXIT_CONFIG } from './paperExitConfig.js'

export const PAPER_EXIT_VERSION = 'paper-exit-v1'
const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export function createPaperExitFingerprint({ positionId, quantity, quote = {}, side } = {}) {
  return hash([positionId, Number(quantity), quote.updatedAt ?? quote.timestamp, Number(quote.price ?? quote.last), side])
}

function rejected(position, status, blockers = []) {
  return { positionId: position?.positionId ?? null, symbol: position?.symbol ?? null, status, blockers, paperTradingOnly: true, automaticExecution: false, liveOrders: false, brokerExecution: false, engineVersion: PAPER_EXIT_VERSION }
}

export function simulatePaperPositionExit({ position, account = {}, quantity, quote = {}, existingExits = [], paperModeEnabled = true, exitReason, policyBar, sessionsHeld } = {}, options = {}) {
  const config = options.config ?? DEFAULT_PAPER_EXIT_CONFIG
  const now = options.now ?? new Date().toISOString()
  if (!paperModeEnabled) return rejected(position, 'REJECTED', ['Paper mode is disabled'])
  if (!position?.positionId || !position.symbol || !positive(position.quantity) || !positive(position.averagePrice) || !['long', 'short'].includes(position.side)) return rejected(position, 'INSUFFICIENT_EXIT_CONTEXT', ['Valid position, side, quantity, and cost basis are required'])
  const requested = Number(quantity)
  if (!positive(requested)) return rejected(position, 'REJECTED', ['Exit quantity must be greater than zero'])
  if (requested > Number(position.quantity)) return rejected(position, 'REJECTED', ['Exit quantity exceeds current paper position'])
  const reference = Number(quote.price ?? quote.last)
  const observedAt = quote.updatedAt ?? quote.timestamp
  const age = Date.parse(now) - Date.parse(observedAt)
  if (!positive(reference)) return rejected(position, 'INSUFFICIENT_EXIT_CONTEXT', ['Reference price is required'])
  if (!Number.isFinite(age) || age < 0 || age > config.maxPriceAgeMs) return rejected(position, 'STALE', ['Reference price is stale or invalid'])

  const emergency = exitReason === 'manual_emergency'
  const policyEvaluators = { 'index-pullback-exit-v1.0.0': evaluateIndexPullbackExitPolicy, 'breakout-momentum-exit-v1.0.0': evaluateBreakoutMomentumExitPolicy, 'range-mean-reversion-exit-v1.0.0': evaluateRangeMeanReversionExitPolicy, 'volatility-expansion-exit-v1.0.0': evaluateVolatilityExpansionExitPolicy }
  const evaluatePolicy = policyEvaluators[position.exitPolicy?.version] ?? evaluateIndexPullbackExitPolicy
  const policyDecision = position.exitPolicy ? evaluatePolicy({ policy: position.exitPolicy, bar: policyBar ?? { open: reference, high: reference, low: reference, close: reference, observedAt, freshness: 'FRESH' }, sessionsHeld }) : null
  const exitAttribution = classifyObservationExit({ policy: position.exitPolicy, quantity: requested, positionQuantity: position.quantity, policyDecision, emergency })
  if (position.exitPolicy && !emergency && exitAttribution.policyCompliant !== true) return { ...rejected(position, 'REJECTED', ['Observation exits must be a full close at a deterministic policy trigger']), exitPolicy: position.exitPolicy, exitAttribution }

  const side = position.side === 'short' ? 'cover' : 'sell'
  const fingerprint = createPaperExitFingerprint({ positionId: position.positionId, quantity: requested, quote: { price: reference, updatedAt: observedAt }, side })
  if (existingExits.some((item) => item.fingerprint === fingerprint)) return { ...rejected(position, 'DUPLICATE_SUPPRESSED', ['Identical exit request was already applied']), fingerprint }
  const trade = { id: `paper-exit-${fingerprint.slice(0, 24)}`, symbol: position.symbol, assetType: position.assetType, side, orderType: 'market', quantity: requested, price: reference, paperTrading: true }
  const prepared = { id: trade.id, symbol: trade.symbol, assetType: trade.assetType, preparationStatus: 'ready', proposedPaperTrade: trade, guardrailEvaluation: { guardrailApproved: true }, tradeGuardrailReference: { eventType: 'trade.guardrail.evaluated' }, sourceDecisionReference: { id: position.originatingEvaluationId, status: 'operator-confirmed' } }
  const portfolio = { id: account.accountId ?? 'paper-portfolio', cash: Number(account.cash ?? 0), equity: Number(account.equity ?? account.cash ?? 0), realizedPnl: Number(account.realizedPnl ?? 0), positions: [position] }
  const execution = simulateRealtimePaperExecution({ preparedTrades: [prepared], portfolio, quote: { last: reference, bid: reference, ask: reference, high: reference, low: reference, liquidityScore: quote.liquidityScore ?? 75, timestamp: observedAt }, paperTrading: true, liveOrders: false, brokerExecution: false }, { emitEvent: false, timestamp: now })
  const item = execution.realtimeSimulatedExecutions[0]
  const accounting = item?.accountingUpdate
  const journal = item?.journalRecord
  if (item?.executionLifecycleStatus !== 'simulated' || !['position_reduced', 'position_closed'].includes(accounting?.status)) return { ...rejected(position, 'REJECTED', [item?.rejectionReason ?? accounting?.reason ?? 'Simulated exit was rejected']), fingerprint }
  const remaining = accounting.positions.find((value) => value.symbol === position.symbol && value.side === position.side) ?? null
  const resultStatus = accounting.status === 'position_closed' ? 'POSITION_CLOSED' : 'POSITION_REDUCED'
  return {
    positionId: position.positionId, candidateId: position.originatingCandidateId, evaluationId: position.originatingEvaluationId,
    symbol: position.symbol, strategyId: position.strategyId, status: resultStatus, fingerprint,
    exitPolicy: position.exitPolicy ?? null, exitAttribution,
    exitPlan: { positionId: position.positionId, symbol: position.symbol, strategyId: position.strategyId, existingSide: position.side, currentQuantity: Number(position.quantity), requestedExitQuantity: requested, remainingQuantity: remaining?.quantity ?? 0, averageCost: Number(position.averagePrice), referencePrice: reference, simulatedExitPrice: item.executionSimulation?.fill?.fillPrice, fees: item.executionSimulation?.fill?.fees, slippageBps: item.executionSimulation?.fill?.slippageBps, realizedPnlDelta: accounting.account.realizedPnlDelta, evidenceTimestamp: observedAt, policyTrigger: policyDecision?.reason ?? null, paperTradingOnly: true, automaticExecution: false },
    positionSnapshot: remaining ? { ...position, ...remaining, positionId: position.positionId } : null,
    accountSnapshot: accounting.account,
    journal: { tradeId: journal?.tradeId, journalStatus: journal?.journalStatus, realizedPnl: journal?.realizedPnl, decisionGate: journal?.decisionGate },
    closedAt: now, tradeQuality: position.tradeQuality ?? null, regime: position.regime ?? null,
    evaluationStatus: position.evaluationStatus ?? 'APPROVED_FOR_PAPER_REVIEW', paperTradingOnly: true,
    automaticExecution: false, liveOrders: false, brokerExecution: false, engineVersion: PAPER_EXIT_VERSION,
  }
}
