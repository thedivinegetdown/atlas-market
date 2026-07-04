import { eventBus as defaultEventBus } from '../../../lib/core/eventBus.js'
import { evaluateRiskAdjustedPerformance } from '../analytics/riskAdjustedPerformanceEngine.js'

export const PORTFOLIO_DRAWDOWN_PROTECTION_EVALUATED_EVENT = 'portfolio.drawdownProtection.evaluated'

function numberValue(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function round(value, decimals = 2) {
  return Number(numberValue(value).toFixed(decimals))
}

function getCurrentEquity(accountState = {}, fallback = 0) {
  return numberValue(
    accountState.account?.equity
      ?? accountState.equity
      ?? accountState.accountValue
      ?? accountState.account?.cash
      ?? accountState.cash,
    fallback,
  )
}

function getTradeId(record = {}, index) {
  return record.tradeId
    ?? record.proposedTradeSnapshot?.id
    ?? record.proposedTradeSnapshot?.tradeId
    ?? record.id
    ?? `trade-${index + 1}`
}

function getRealizedPnl(record = {}) {
  return numberValue(record.realizedPnl ?? record.accountingUpdateSnapshot?.account?.realizedPnlDelta)
}

function getRecordTimestamp(record = {}) {
  return record.timestamp
    ?? record.accountingUpdateSnapshot?.timestamp
    ?? record.executionSimulationSnapshot?.timestamp
    ?? record.guardrailDecisionSnapshot?.timestamp
    ?? null
}

function isSameUtcDay(left, right) {
  return left.getUTCFullYear() === right.getUTCFullYear()
    && left.getUTCMonth() === right.getUTCMonth()
    && left.getUTCDate() === right.getUTCDate()
}

function isWithinTrailingDays(left, right, days) {
  const diffMs = right.getTime() - left.getTime()
  return diffMs >= 0 && diffMs <= days * 24 * 60 * 60 * 1000
}

function calculateLossWindow(journalRecords, includedTradeIds, timestamp, equityPeak, mode) {
  const now = new Date(timestamp)
  const loss = journalRecords.reduce((sum, record, index) => {
    const tradeId = getTradeId(record, index)
    const recordDate = new Date(getRecordTimestamp(record) ?? timestamp)
    const inWindow = mode === 'daily'
      ? isSameUtcDay(recordDate, now)
      : isWithinTrailingDays(recordDate, now, 7)

    if (!includedTradeIds.has(tradeId) || !inWindow) return sum

    return Math.min(0, sum + getRealizedPnl(record))
  }, 0)

  return {
    amount: round(Math.abs(loss)),
    pct: equityPeak > 0 ? round((Math.abs(loss) / equityPeak) * 100, 4) : 0,
  }
}

function getProtectionStatus({ currentDrawdown, maxDrawdownThreshold, dailyLossPct, dailyLossThreshold, weeklyLossPct, weeklyLossThreshold }) {
  if (
    currentDrawdown >= maxDrawdownThreshold
    || dailyLossPct >= dailyLossThreshold
    || weeklyLossPct >= weeklyLossThreshold
  ) {
    return {
      protectionStatus: 'locked',
      recommendedAction: 'pause trading',
    }
  }

  if (
    currentDrawdown >= maxDrawdownThreshold * 0.75
    || dailyLossPct >= dailyLossThreshold * 0.75
    || weeklyLossPct >= weeklyLossThreshold * 0.75
  ) {
    return {
      protectionStatus: 'caution',
      recommendedAction: 'reduce risk',
    }
  }

  return {
    protectionStatus: 'clear',
    recommendedAction: 'continue',
  }
}

function buildWarnings({ currentDrawdown, maxDrawdownThreshold, dailyLossPct, dailyLossThreshold, weeklyLossPct, weeklyLossThreshold }) {
  const warnings = []

  if (currentDrawdown >= maxDrawdownThreshold) {
    warnings.push(`Current drawdown ${round(currentDrawdown)}% exceeds max threshold ${round(maxDrawdownThreshold)}%`)
  }

  if (dailyLossPct >= dailyLossThreshold) {
    warnings.push(`Daily loss ${round(dailyLossPct)}% exceeds threshold ${round(dailyLossThreshold)}%`)
  }

  if (weeklyLossPct >= weeklyLossThreshold) {
    warnings.push(`Weekly loss ${round(weeklyLossPct)}% exceeds threshold ${round(weeklyLossThreshold)}%`)
  }

  return warnings
}

export function evaluateDrawdownProtection(accountState = {}, journalRecords = [], options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? new Date().toISOString()
  const records = Array.isArray(journalRecords) ? journalRecords : []
  const riskAdjustedPerformance = options.riskAdjustedPerformance
    ?? evaluateRiskAdjustedPerformance(records, {
      emitEvent: false,
      startingEquity: getCurrentEquity(accountState, 100000),
      timestamp,
    })
  const maxDrawdownThreshold = numberValue(options.maxDrawdownThreshold, 10)
  const dailyLossThreshold = numberValue(options.dailyLossThreshold, 3)
  const weeklyLossThreshold = numberValue(options.weeklyLossThreshold, 6)
  const currentEquity = getCurrentEquity(accountState, riskAdjustedPerformance.startingEquity)
  const drawdownEquities = (riskAdjustedPerformance.drawdownSeries ?? []).map((point) => numberValue(point.equity))
  const equityPeak = Math.max(
    numberValue(options.equityPeak),
    numberValue(riskAdjustedPerformance.startingEquity),
    currentEquity,
    ...drawdownEquities,
  )
  const currentDrawdown = equityPeak > 0 ? ((equityPeak - currentEquity) / equityPeak) * 100 : 0
  const includedTradeIds = new Set((riskAdjustedPerformance.returnSeries ?? []).map((point) => point.tradeId))
  const dailyLoss = calculateLossWindow(records, includedTradeIds, timestamp, equityPeak, 'daily')
  const weeklyLoss = calculateLossWindow(records, includedTradeIds, timestamp, equityPeak, 'weekly')
  const protection = getProtectionStatus({
    currentDrawdown,
    maxDrawdownThreshold,
    dailyLossPct: dailyLoss.pct,
    dailyLossThreshold,
    weeklyLossPct: weeklyLoss.pct,
    weeklyLossThreshold,
  })
  const warnings = buildWarnings({
    currentDrawdown,
    maxDrawdownThreshold,
    dailyLossPct: dailyLoss.pct,
    dailyLossThreshold,
    weeklyLossPct: weeklyLoss.pct,
    weeklyLossThreshold,
  })

  const result = {
    eventType: PORTFOLIO_DRAWDOWN_PROTECTION_EVALUATED_EVENT,
    paperTrading: true,
    timestamp,
    status: 'evaluated',
    protectionStatus: protection.protectionStatus,
    recommendedAction: protection.recommendedAction,
    equityPeak: round(equityPeak),
    currentEquity: round(currentEquity),
    currentDrawdown: round(currentDrawdown, 4),
    maxDrawdownThreshold: round(maxDrawdownThreshold, 4),
    dailyLossThreshold: round(dailyLossThreshold, 4),
    weeklyLossThreshold: round(weeklyLossThreshold, 4),
    dailyLoss,
    weeklyLoss,
    riskAdjustedGrade: riskAdjustedPerformance.metrics?.riskAdjustedGrade ?? 'N/A',
    riskAdjustedMaxDrawdown: riskAdjustedPerformance.metrics?.maxDrawdown ?? 0,
    warnings,
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(PORTFOLIO_DRAWDOWN_PROTECTION_EVALUATED_EVENT, result)
  }

  return result
}

export function createDrawdownProtectionEngine(options = {}) {
  return {
    evaluate(accountState, journalRecords, protectionOptions = {}) {
      return evaluateDrawdownProtection(accountState, journalRecords, { ...options, ...protectionOptions })
    },
  }
}
