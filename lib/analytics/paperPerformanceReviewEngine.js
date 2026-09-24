import { evaluatePaperPerformance } from '../../src/core/analytics/paperPerformanceAnalyticsEngine.js'
import { DEFAULT_PAPER_PERFORMANCE_REVIEW_CONFIG } from './paperPerformanceReviewConfig.js'

export const PAPER_PERFORMANCE_REVIEW_VERSION='paper-performance-review-v1'

const round = (value, decimals = 2) => Number((Number(value) || 0).toFixed(decimals))
const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
const finite = (value) => value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null

function outcome(record = {}) {
  const accounting = record.accountingStatus ?? record.accountingUpdate?.status ?? record.accountingUpdateSnapshot?.status
  const pnl = finite(record.netPnl ?? record.realizedPnl ?? record.accountingUpdate?.account?.realizedPnlDelta ?? record.accountingUpdateSnapshot?.account?.realizedPnlDelta)
  const filled = record.status === 'SIMULATED_FILLED' || record.executionStatus === 'simulated' || record.decisionGate?.execution === 'filled'
  return { eligible: record.paperTradingOnly !== false && record.paperTrading !== false && filled && accounting === 'position_closed' && pnl != null, pnl, accounting }
}

function sampleStatus(count, config) {
  return count < config.minimumSample ? 'INSUFFICIENT_SAMPLE' : count < config.developingSample ? 'EARLY' : count < config.establishedSample ? 'DEVELOPING' : 'ESTABLISHED'
}

function streaks(values) {
  let wins = 0, losses = 0, maximumWins = 0, maximumLosses = 0
  for (const value of values) {
    if (value > 0) { wins += 1; losses = 0; maximumWins = Math.max(maximumWins, wins) }
    else if (value < 0) { losses += 1; wins = 0; maximumLosses = Math.max(maximumLosses, losses) }
    else { wins = 0; losses = 0 }
  }
  return { consecutiveWins: maximumWins, consecutiveLosses: maximumLosses }
}

function drawdownMetrics(equityChronology) {
  if (equityChronology?.status !== 'COMPLETE') return { status: 'UNAVAILABLE', maximumDrawdownPct: null, averageDrawdownPct: null, recoveryStatus: 'UNAVAILABLE' }
  const points = (equityChronology.points ?? []).map((point) => ({ ...point, equity: finite(point.equity) })).filter((point) => point.equity != null && point.equity > 0)
  const values = points.map((point) => point.equity)
  if (!values.length) return { status: 'UNAVAILABLE', maximumDrawdownPct: null, averageDrawdownPct: null, recoveryStatus: 'UNAVAILABLE' }
  let peak = values[0]
  let peakIndex = 0, maximum = 0, maximumPeak = peak, maximumPeakIndex = 0, trough = peak, troughIndex = 0
  const drawdowns = values.map((value, index) => {
    if (value > peak) { peak = value; peakIndex = index }
    const drawdown = peak > 0 ? ((peak - value) / peak) * 100 : 0
    if (drawdown > maximum) { maximum = drawdown; maximumPeak = peak; maximumPeakIndex = peakIndex; trough = value; troughIndex = index }
    return drawdown
  })
  const recoveryIndex = maximum > 0 ? values.findIndex((value, index) => index > troughIndex && value >= maximumPeak) : 0
  return {
    status: 'AVAILABLE',
    maximumDrawdownPct: round(maximum),
    averageDrawdownPct: round(average(drawdowns)),
    peakEquity: round(Math.max(...values)),
    maximumDrawdownPeakEquity: round(maximumPeak),
    maximumDrawdownPeakAt: points[maximumPeakIndex]?.timestamp ?? null,
    troughEquity: round(trough),
    troughAt: points[troughIndex]?.timestamp ?? null,
    recoveryStatus: maximum === 0 ? 'NO_DRAWDOWN' : recoveryIndex >= 0 ? 'RECOVERED' : 'UNRECOVERED',
    recoveredAt: recoveryIndex >= 0 ? points[recoveryIndex]?.timestamp ?? null : null,
    endingEquity: round(values.at(-1)),
  }
}

function metrics(records, options = {}) {
  const rows = records.map((record) => ({ pnl: outcome(record).pnl, returnPct: finite(record.returnPct), record }))
  const pnl = rows.map((row) => row.pnl)
  const wins = pnl.filter((value) => value > 0), losses = pnl.filter((value) => value < 0), zeros = pnl.filter((value) => value === 0)
  const base = evaluatePaperPerformance(rows.map((row, index) => ({ tradeId: row.record.id ?? `trade-${index}`, paperTrading: true, journalStatus: 'recorded', fill: {}, decisionGate: { execution: 'filled', accounting: 'updated' }, realizedPnl: row.pnl })), { emitEvent: false, timestamp: '1970-01-01T00:00:00.000Z' }).metrics
  const returns = rows.map((row) => row.returnPct).filter((value) => value != null)
  const mean = average(returns)
  const volatility = returns.length > 1 ? Math.sqrt(average(returns.map((value) => (value - mean) ** 2))) : 0
  const downside = returns.filter((value) => value < 0)
  const downsideDeviation = downside.length ? Math.sqrt(average(downside.map((value) => value ** 2))) : 0
  const drawdown = drawdownMetrics(options.equityChronology)
  return {
    totalCompletedTrades: pnl.length, winningTrades: wins.length, losingTrades: losses.length, breakevenTrades: zeros.length,
    winRate: round(pnl.length ? wins.length / pnl.length * 100 : 0), lossRate: round(pnl.length ? losses.length / pnl.length * 100 : 0),
    averageWin: round(average(wins)), averageLoss: round(average(losses)), winLossRatio: round(losses.length && average(losses) !== 0 ? average(wins) / Math.abs(average(losses)) : 0),
    expectancyPerTrade: round(base.expectancy), grossProfit: round(wins.reduce((sum, value) => sum + value, 0)), grossLoss: round(Math.abs(losses.reduce((sum, value) => sum + value, 0))),
    netRealizedPnl: round(base.netRealizedPnl), profitFactor: base.profitFactor, largestWin: base.largestWin, largestLoss: base.largestLoss,
    ...streaks(pnl), drawdownStatus: drawdown.status, maximumDrawdownPct: drawdown.maximumDrawdownPct, averageDrawdownPct: drawdown.averageDrawdownPct,
    accountEquityDrawdown: drawdown,
    recoveryFactor: drawdown.maximumDrawdownPct > 0 ? round(base.netRealizedPnl / drawdown.maximumDrawdownPct) : null,
    averageTradeReturn: round(mean), returnVolatility: round(volatility), sharpeStyle: returns.length >= 5 && volatility > 0 ? round(mean / volatility) : null,
    sortinoStyle: returns.length >= 5 && downsideDeviation > 0 ? round(mean / downsideDeviation) : null,
  }
}

function group(records, key, label, config, options) {
  const groups = new Map()
  for (const record of records) {
    const value = key(record)
    if (value == null || value === '' || value === 'UNKNOWN') continue
    groups.set(String(value), [...(groups.get(String(value)) ?? []), record])
  }
  return [...groups].sort(([left], [right]) => left.localeCompare(right)).map(([value, rows]) => rows.length < config.minimumGroupSample
    ? { dimension: label, value, sampleSize: rows.length, status: 'INSUFFICIENT_SAMPLE' }
    : { dimension: label, value, sampleSize: rows.length, status: sampleStatus(rows.length, config), performance: metrics(rows, options) })
}

function trend(records, config, options) {
  if (records.length < config.minimumSample) return 'INSUFFICIENT_DATA'
  const recent = records.slice(-Math.min(config.recentWindow, records.length))
  const baseline = records.slice(0, -recent.length)
  if (!baseline.length) return 'STABLE'
  const recentExpectancy = metrics(recent, options).expectancyPerTrade
  const baselineExpectancy = metrics(baseline, options).expectancyPerTrade
  const scale = Math.max(1, Math.abs(baselineExpectancy))
  if ((recentExpectancy - baselineExpectancy) / scale * 100 >= config.improvementPct) return 'IMPROVING'
  if ((baselineExpectancy - recentExpectancy) / scale * 100 >= config.deteriorationPct) return 'DETERIORATING'
  return 'STABLE'
}

function reviewStatus(performance, sample, recent, config, coverage) {
  if (sample === 'INSUFFICIENT_SAMPLE') return 'INSUFFICIENT_SAMPLE'
  if (coverage < 80) return 'UNDER_REVIEW'
  if ((performance.drawdownStatus === 'AVAILABLE' && performance.maximumDrawdownPct >= config.degradedDrawdownPct) || performance.profitFactor < config.cautionProfitFactor) return 'DEGRADED'
  if (recent === 'DETERIORATING' || (performance.drawdownStatus === 'AVAILABLE' && performance.maximumDrawdownPct >= config.cautionDrawdownPct) || performance.expectancyPerTrade <= 0) return 'CAUTION'
  if (performance.profitFactor >= config.healthyProfitFactor && performance.expectancyPerTrade > 0) return 'HEALTHY'
  return 'UNDER_REVIEW'
}

function cohortIsolation(records, enabled) {
  if (!enabled) return { records, excluded: [], incompatible: false, cohortKeys: [] }
  const excluded = records.filter((record) => record.attribution?.status !== 'COMPLETE' || !record.cohortKey)
  const included = records.filter((record) => record.attribution?.status === 'COMPLETE' && record.cohortKey)
  const cohortKeys = [...new Set(included.map((record) => record.cohortKey))]
  return { records: cohortKeys.length > 1 ? [] : included, excluded, incompatible: cohortKeys.length > 1, cohortKeys }
}

export function reviewPaperPerformance(records = [], options = {}) {
  const config = options.config ?? DEFAULT_PAPER_PERFORMANCE_REVIEW_CONFIG
  const asOf = options.asOf ?? new Date().toISOString()
  const sorted = [...(Array.isArray(records) ? records : [])].sort((left, right) => Date.parse(left.closedAt ?? left.simulatedAt ?? left.timestamp) - Date.parse(right.closedAt ?? right.simulatedAt ?? right.timestamp) || String(left.id ?? left.evaluationId).localeCompare(String(right.id ?? right.evaluationId)))
  const eligible = sorted.filter((record) => outcome(record).eligible)
  const isolation = cohortIsolation(eligible, options.cohortIsolation === true)
  const completed = isolation.records
  const excluded = [...sorted.filter((record) => !outcome(record).eligible), ...(isolation.incompatible ? eligible : isolation.excluded)]
  const performance = metrics(completed, options)
  const sample = sampleStatus(completed.length, config)
  const recentTrend = trend(completed, config, options)
  const coverage = sorted.length ? round(completed.length / sorted.length * 100) : 0
  const status = isolation.incompatible ? 'INCOMPATIBLE_COHORTS' : reviewStatus(performance, sample, recentTrend, config, coverage)
  const grouping = [
    ['strategies', (record) => record.strategyId, 'strategyId'],
    ['qualityBands', (record) => record.tradeQuality?.band ?? record.qualityBand, 'qualityBand'],
    ['qualityScoreRanges', (record) => { const value = finite(record.tradeQuality?.score ?? record.qualityScore); return value == null ? null : value >= 90 ? '90-100' : value >= 80 ? '80-89' : value >= 70 ? '70-79' : value >= 55 ? '55-69' : '0-54' }, 'qualityScoreRange'],
    ['trendRegimes', (record) => record.regime?.trendRegime, 'trendRegime'], ['volatilityRegimes', (record) => record.regime?.volatilityRegime, 'volatilityRegime'],
    ['riskRegimes', (record) => record.regime?.riskRegime, 'riskRegime'], ['evaluationStatuses', (record) => record.evaluationStatus, 'evaluationStatus'],
    ['symbols', (record) => record.symbol, 'symbol'], ['assetTypes', (record) => record.assetType ?? record.orderPlan?.assetType, 'assetType'],
    ['months', (record) => String(record.closedAt ?? record.simulatedAt ?? '').slice(0, 7), 'month'],
  ]
  const feedback = []
  if (isolation.incompatible) feedback.push('Incompatible immutable fingerprints were excluded from pooled metrics.')
  else if (sample === 'INSUFFICIENT_SAMPLE') feedback.push('Insufficient sample; continue paper observation.')
  else {
    if (performance.expectancyPerTrade > 0 && (performance.drawdownStatus !== 'AVAILABLE' || performance.maximumDrawdownPct < config.cautionDrawdownPct)) feedback.push('Positive expectancy; canonical account-equity drawdown is reported separately when available.')
    if (recentTrend === 'DETERIORATING') feedback.push('Strategy results have deteriorated over the recent window.')
    if (performance.drawdownStatus === 'AVAILABLE' && performance.maximumDrawdownPct >= config.cautionDrawdownPct) feedback.push('Recent drawdown is elevated.')
  }
  return {
    version: PAPER_PERFORMANCE_REVIEW_VERSION, status, asOf,
    sample: { status: sample, completedTrades: performance.totalCompletedTrades, wins: performance.winningTrades, losses: performance.losingTrades, breakeven: performance.breakevenTrades },
    performance, recentTrend, feedback,
    cohortIsolation: { status: isolation.incompatible ? 'INCOMPATIBLE' : isolation.cohortKeys.length === 1 ? 'COMPATIBLE' : options.cohortIsolation === true ? 'NO_COMPARABLE_COHORT' : 'NOT_REQUESTED', cohortKeys: isolation.cohortKeys, excluded: isolation.excluded.length },
    coverage: { percentage: coverage, totalRecords: sorted.length, completed: completed.length, excluded: excluded.length, missingLinkage: excluded.filter((record) => record.status === 'SIMULATED_FILLED').length, excludedByState: excluded.reduce((result, record) => { const key = record.attribution?.status ? `ATTRIBUTION_${record.attribution.status}` : record.status ?? 'INCOMPLETE'; result[key] = (result[key] ?? 0) + 1; return result }, {}) },
    ...Object.fromEntries(grouping.map(([name, key, label]) => [name, group(completed, key, label, config, options)])),
    boundaries: { paperTradingOnly: true, advisoryOnly: true, automaticStrategyChanges: false, automaticExecution: false },
  }
}
