import { randomUUID } from 'node:crypto'
import { AppError } from '../errors/appError.js'
import { reviewPaperPerformance } from '../analytics/paperPerformanceReview.js'
import { buildPaperLearningEvidence } from '../analytics/paperLearning/index.js'

function durableStateError() {
  return new AppError('durable_workspace_state_unavailable', 'Canonical PostgreSQL workspace state is unavailable.', {
    statusCode: 503,
    publicMessage: 'durable workspace state is unavailable',
  })
}

function scopeError() {
  return new AppError('durable_workspace_scope_invalid', 'Organization, account, and user scope are required.', {
    statusCode: 403,
    publicMessage: 'workspace scope is invalid',
  })
}

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback
const round = (value, decimals = 2) => Number(finite(value).toFixed(decimals))

function normalizeScope(input = {}) {
  const tenant = input.tenantContext ?? {}
  const result = {
    organizationId: String(tenant.organizationId ?? '').trim(),
    teamWorkspaceId: String(tenant.teamWorkspaceId ?? '').trim(),
    accountId: String(input.accountId ?? '').trim(),
    userId: String(input.userId ?? tenant.userId ?? '').trim(),
  }
  if (!result.organizationId || !result.accountId || !result.userId) throw scopeError()
  return result
}

function performanceExecution(execution = {}) {
  const payload = execution.payload ?? {}
  return {
    id: execution.executionId ?? execution.fingerprint,
    status: 'SIMULATED_FILLED',
    symbol: execution.symbol,
    strategyId: execution.strategyId,
    assetType: payload.assetType,
    closedAt: execution.evidenceTimestamp ?? execution.createdAt,
    accountingStatus: execution.executionType === 'close' ? 'position_closed' : 'position_reduced',
    realizedPnl: execution.realizedPnlDelta,
    tradeQuality: payload.tradeQuality,
    regime: payload.regime,
    evaluationStatus: payload.evaluationStatus,
    paperTradingOnly: true,
  }
}

export function buildDurablePaperWorkflowProjections({ account = {}, positions = [], executions = [], asOf } = {}) {
  const realized = executions.filter((item) => ['reduction', 'close'].includes(item.executionType))
  const performance = reviewPaperPerformance(realized.map(performanceExecution), { asOf })
  const realizedValues = realized.map((item) => finite(item.realizedPnlDelta))
  const initialCash = round(finite(account.cash) - executions.reduce((sum, item) => sum + finite(item.cashImpact), 0))
  const startingBalance = initialCash || 100_000
  const equityPath = realizedValues.reduce((values, value) => [...values, round(values.at(-1) + value)], [startingBalance])
  const drawdown = equityPath.reduce((state, value) => {
    const peak = Math.max(state.peak, value)
    return { peak, maximum: Math.max(state.maximum, peak ? ((peak - value) / peak) * 100 : 0) }
  }, { peak: startingBalance, maximum: 0 }).maximum
  const winners = realizedValues.filter((value) => value > 0)
  const losers = realizedValues.filter((value) => value < 0)
  const projectedPositions = positions.map((position) => {
    const direction = position.side === 'short' ? -1 : 1
    return {
      positionId: position.positionId,
      symbol: position.symbol,
      assetType: position.assetType,
      side: position.side,
      quantity: finite(position.quantity),
      averageCost: finite(position.averagePrice),
      currentPrice: finite(position.currentPrice),
      marketValue: round(finite(position.quantity) * finite(position.currentPrice) * direction),
      unrealizedPnl: round((finite(position.currentPrice) - finite(position.averagePrice)) * finite(position.quantity) * direction),
      realizedPnl: finite(position.realizedPnl),
      strategyId: position.strategyId,
      priceProvenance: {
        dataStatus: 'UNKNOWN',
        provider: 'durable-ledger',
        reason: 'No fresh market quote requested for deterministic persistence projection',
      },
      paperTradingOnly: true,
    }
  })
  const entries = executions.map((execution) => {
    const normalizedJournal = execution.payload?.journal ?? {}
    return {
      id: execution.executionId,
      symbol: normalizedJournal.symbol ?? execution.symbol,
      strategy: normalizedJournal.strategy ?? execution.strategyId ?? 'Systematic',
      emotion: normalizedJournal.emotion ?? 'system',
      notes: normalizedJournal.notes ?? `Paper ${execution.executionType} execution`,
      tags: normalizedJournal.tags ?? ['paper-only', 'immutable-execution', execution.executionType],
      result: execution.executionType === 'entry' ? 'neutral' : finite(execution.realizedPnlDelta) > 0 ? 'win' : finite(execution.realizedPnlDelta) < 0 ? 'loss' : 'neutral',
      duration: normalizedJournal.duration ?? 'n/a',
      pnl: finite(execution.realizedPnlDelta),
      quantity: finite(execution.quantity),
      fillPrice: finite(execution.fillPrice),
      fees: finite(execution.fees),
      side: execution.side,
      createdAt: normalizedJournal.createdAt ?? execution.evidenceTimestamp ?? execution.createdAt,
      paperTradingOnly: true,
      immutableSource: true,
    }
  })

  return {
    paperTrading: true,
    canonicalDurableSource: true,
    summary: {
      accountValue: finite(account.equity), cash: finite(account.cash), buyingPower: finite(account.buyingPower),
      realizedPnl: finite(account.realizedPnl), dailyReturn: realizedValues.length && startingBalance ? realizedValues.at(-1) / startingBalance * 100 : 0,
      totalReturn: startingBalance ? (finite(account.equity) - startingBalance) / startingBalance * 100 : 0,
      winRate: performance.performance.winRate, averageWinner: performance.performance.averageWin,
      averageLoser: performance.performance.averageLoss, profitFactor: performance.performance.profitFactor === Infinity ? 999 : performance.performance.profitFactor,
      sharpeRatio: performance.performance.sharpeStyle ?? 0, maxDrawdown: round(drawdown), expectancy: performance.performance.expectancyPerTrade,
      largestWinner: winners.length ? Math.max(...winners) : 0, largestLoser: losers.length ? Math.min(...losers) : 0,
      openRisk: 0, revision: finite(account.revision),
    },
    positions: projectedPositions,
    executions,
    journal: { paperTrading: true, entries, symbols: [...new Set(entries.map((item) => item.symbol).filter(Boolean))].sort(), immutableExecutionProjection: true },
    performance,
    learning: buildPaperLearningEvidence(performance),
  }
}

export function createDurableWorkspaceStateRepository({ database } = {}) {
  if (!database?.connected || typeof database.query !== 'function') throw durableStateError()

  async function list(table, statusColumn, input) {
    const tenant = normalizeScope(input)
    const result = await database.query(
      `SELECT payload FROM ${table}
       WHERE organization_id=$1 AND COALESCE(team_workspace_id,'')=$2 AND account_id=$3 AND user_id=$4
         AND ${statusColumn} <> 'deleted' ORDER BY updated_at DESC`,
      [tenant.organizationId, tenant.teamWorkspaceId, tenant.accountId, tenant.userId],
    )
    return result.rows.map((row) => row.payload)
  }

  async function save(kind, input, value) {
    const tenant = normalizeScope(input)
    const scanner = kind === 'scanner'
    const table = scanner ? 'atlas_realtime_scanner_subscriptions' : 'atlas_realtime_alerts'
    const statusColumn = scanner ? 'scanner_status' : 'alert_status'
    const id = String(value.id ?? `${kind}-${randomUUID()}`)
    const payload = {
      ...value, id, enabled: value.enabled !== false, tenantScope: tenant,
      createdAt: value.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString(), paperTrading: true,
    }
    const extraColumns = scanner ? 'symbol' : 'severity,symbol'
    const extraPlaceholders = scanner ? '$8' : '$8,$9'
    const extraValues = scanner ? [payload.symbols?.[0] ?? null] : ['informational', payload.symbol]
    const result = await database.query(
      `INSERT INTO ${table} (id,organization_id,team_workspace_id,account_id,user_id,${statusColumn},payload,${extraColumns},created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,${extraPlaceholders},NOW(),NOW())
       ON CONFLICT (id) DO UPDATE SET ${statusColumn}=EXCLUDED.${statusColumn},payload=EXCLUDED.payload,updated_at=NOW()
       WHERE ${table}.organization_id=EXCLUDED.organization_id
         AND COALESCE(${table}.team_workspace_id,'')=COALESCE(EXCLUDED.team_workspace_id,'')
         AND ${table}.account_id=EXCLUDED.account_id AND ${table}.user_id=EXCLUDED.user_id
       RETURNING payload`,
      [id, tenant.organizationId, tenant.teamWorkspaceId, tenant.accountId, tenant.userId, payload.enabled ? 'active' : 'idle', payload, ...extraValues],
    )
    if (!result.rows[0]) {
      throw new AppError('durable_workspace_scope_conflict', 'Cross-tenant state mutation denied.', { statusCode: 403, publicMessage: 'workspace access denied' })
    }
    return result.rows[0].payload
  }

  async function remove(kind, input, id) {
    const tenant = normalizeScope(input)
    const scanner = kind === 'scanner'
    const table = scanner ? 'atlas_realtime_scanner_subscriptions' : 'atlas_realtime_alerts'
    const statusColumn = scanner ? 'scanner_status' : 'alert_status'
    const result = await database.query(
      `UPDATE ${table} SET ${statusColumn}='deleted',updated_at=NOW()
       WHERE id=$1 AND organization_id=$2 AND COALESCE(team_workspace_id,'')=$3 AND account_id=$4 AND user_id=$5 RETURNING id`,
      [id, tenant.organizationId, tenant.teamWorkspaceId, tenant.accountId, tenant.userId],
    )
    return result.rowCount > 0
  }

  return {
    persistenceMode: 'postgresql',
    listScanners: (input) => list('atlas_realtime_scanner_subscriptions', 'scanner_status', input),
    saveScanner: (input, value) => save('scanner', input, value),
    deleteScanner: (input, id) => remove('scanner', input, id),
    listAlerts: (input) => list('atlas_realtime_alerts', 'alert_status', input),
    saveAlert: (input, value) => save('alert', input, value),
    deleteAlert: (input, id) => remove('alert', input, id),
  }
}

export function resolveDurableWorkspaceStateRepository({ persistenceRepository, durableRepository, env = process.env } = {}) {
  if (durableRepository) {
    if (durableRepository.persistenceMode === 'memory' && env.NODE_ENV === 'production') throw durableStateError()
    return durableRepository
  }
  return createDurableWorkspaceStateRepository({ database: persistenceRepository })
}
