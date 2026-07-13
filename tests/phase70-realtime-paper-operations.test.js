import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { evaluateRealtimePaperDecisions } from '../lib/trading/realTimePaperDecisionCoordinator.js'
import { prepareRealtimePaperTrades } from '../lib/trading/realTimePaperTradePreparationCoordinator.js'
import { simulateRealtimePaperExecution } from '../lib/trading/realTimeSimulatedExecutionCoordinator.js'
import { reconcileRealtimePortfolio } from '../lib/trading/realTimePortfolioReconciliationEngine.js'
import { streamRealtimePaperPortfolio } from '../lib/trading/realTimePortfolioStreamingEngine.js'
import { createRealtimePaperRiskRepository, monitorRealtimePaperRisk, PAPER_RISK_REALTIME_MONITORED_EVENT } from '../lib/trading/realTimePaperRiskMonitorEngine.js'
import { createRealtimePaperPerformanceRepository, streamRealtimePaperPerformance, PAPER_PERFORMANCE_REALTIME_UPDATED_EVENT } from '../lib/trading/realTimePaperPerformanceStreamEngine.js'
import { createRealtimePaperOperationsRepository, evaluateRealtimePaperOperations, PAPER_OPERATIONS_REALTIME_EVALUATED_EVENT } from '../lib/trading/realTimePaperOperationsCommandCenterEngine.js'
import { evaluatePortfolioRisk } from '../src/core/risk/portfolioRiskEngine.js'
import { evaluateDrawdownProtection } from '../src/core/risk/drawdownProtectionEngine.js'
import { recommendCapitalAllocation } from '../src/core/analytics/capitalAllocationEngine.js'
import { evaluatePortfolioAnalytics } from '../src/core/analytics/portfolioAnalyticsEngine.js'
import { evaluateRiskAdjustedPerformance } from '../src/core/analytics/riskAdjustedPerformanceEngine.js'
import { createRealtimePaperRiskHandler } from '../netlify/functions/realtime-paper-risk.js'
import { createRealtimePaperPerformanceHandler } from '../netlify/functions/realtime-paper-performance.js'
import { createRealtimePaperOperationsHandler } from '../netlify/functions/realtime-paper-operations.js'

const userId = 'local-development:local-operator'
const tenantContext = { organizationId: 'org-atlas-local', teamWorkspaceId: null, userId, role: 'analyst' }
const portfolio = { id: 'paper-portfolio', cash: 100000, accountValue: 100000, buyingPower: 100000, positions: [] }
const tradeTemplate = { id: 'paper-trade-rt-ops-1', symbol: 'SPY', assetType: 'etf', side: 'buy', orderType: 'market', quantity: 5, price: 100, paperTrading: true }
const quote = { last: 100, bid: 100, ask: 100, high: 101, low: 99, liquidityScore: 90 }

function parseResponse(response) {
  return { ...response, json: response.body ? JSON.parse(response.body) : null }
}

function authEvent(method = 'GET', body = {}, role = 'analyst', organizationId = 'org-atlas-local') {
  return {
    httpMethod: method,
    headers: {
      authorization: 'Bearer dev-token',
      'content-type': 'application/json',
      'x-csrf-token': 'csrf-ready',
      'x-request-id': 'req-phase70',
      'x-atlas-dev-role': role,
      'x-atlas-dev-subject': 'local-operator',
    },
    queryStringParameters: { organizationId, accountId: 'paper-portfolio', limit: '25' },
    body: method === 'POST' ? JSON.stringify(body) : '',
  }
}

function membershipRepository(role = 'analyst') {
  return {
    getMembership: vi.fn(async (organizationId) => organizationId === 'org-atlas-local'
      ? { id: `membership-${role}`, organizationId: 'org-atlas-local', userId, role, status: 'active' }
      : null),
  }
}

function lifecycle() {
  const portfolioRisk = evaluatePortfolioRisk(portfolio, { emitEvent: false })
  const drawdownProtection = evaluateDrawdownProtection(portfolio, [], { emitEvent: false })
  const capitalAllocation = recommendCapitalAllocation(portfolio, { emitEvent: false, riskSnapshot: portfolioRisk, drawdownProtection })
  const realtimeSignals = {
    signalEvaluationStatus: 'active',
    realtimeSignalEvaluations: [{
      id: 'realtime-signal-spy-ops-1',
      tenantScope: tenantContext,
      symbol: 'SPY',
      assetType: 'etf',
      signalStatus: 'qualified',
      signalConfidence: 94,
      signalAction: 'BUY',
      sourceEventReferences: [{ id: 'route-1', eventType: 'marketData.streamingEvent.routed' }],
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    }],
  }
  const realtimeAlerts = { alertPipelineStatus: 'healthy', realtimeAlertSummary: { total: 1 }, realtimeAlerts: [{ id: 'alert-1', alertLifecycleStatus: 'open' }] }
  const realtimePaperDecisions = evaluateRealtimePaperDecisions({
    tenantContext,
    realtimeSignals,
    realtimeAlerts,
    researchEnhancedDecision: { eventType: 'ai.decision.researchEnhanced', finalDecision: 'approved' },
    marketRegimeClassification: { eventType: 'market.regime.classified', compositeRegimeLabel: 'risk-on uptrend' },
    portfolioRisk,
    drawdownProtection,
    capitalAllocation,
    strategyLifecycle: { eventType: 'strategy.lifecycle.updated', lifecycleState: 'active' },
    strategyRegistry: { eventType: 'strategy.registry.updated', registryStatus: 'active' },
  }, { emitEvent: false, timestamp: '2026-07-13T12:00:00.000Z' })
  const realtimePreparedTrades = prepareRealtimePaperTrades({
    tenantContext,
    realtimePaperDecisions,
    portfolio,
    portfolioRisk,
    drawdownProtection,
    capitalAllocation,
    tradeTemplate,
    quote,
  }, { emitEvent: false, timestamp: '2026-07-13T12:01:00.000Z' })
  const realtimeSimulatedExecutions = simulateRealtimePaperExecution({
    tenantContext,
    realtimePreparedTrades,
    portfolio,
    quote,
    realtimeAlerts,
  }, { emitEvent: false, timestamp: '2026-07-13T12:02:00.000Z' })
  const realtimePortfolioReconciliation = reconcileRealtimePortfolio({
    tenantContext,
    accountId: 'paper-portfolio',
    realtimeSimulatedExecutions,
  }, { emitEvent: false, timestamp: '2026-07-13T12:03:00.000Z' })
  const portfolioAnalytics = evaluatePortfolioAnalytics(portfolio, { emitEvent: false, riskSnapshot: portfolioRisk })
  const realtimePaperPortfolio = streamRealtimePaperPortfolio({
    tenantContext,
    accountId: 'paper-portfolio',
    realtimePortfolioReconciliation,
    portfolioAnalytics,
    portfolioRisk,
  }, { emitEvent: false, timestamp: '2026-07-13T12:04:00.000Z' })
  const realtimePaperRisk = monitorRealtimePaperRisk({
    tenantContext,
    accountId: 'paper-portfolio',
    realtimePaperPortfolio,
    realtimePortfolioReconciliation,
    portfolioRisk,
    drawdownProtection,
    latestGuardrailEvaluation: realtimePreparedTrades.realtimeGuardrailEvaluations[0],
  }, { emitEvent: false, timestamp: '2026-07-13T12:05:00.000Z' })
  const realtimePaperPerformance = streamRealtimePaperPerformance({
    tenantContext,
    accountId: 'paper-portfolio',
    realtimePaperPortfolio,
    realtimePortfolioReconciliation,
    realtimeSimulatedExecutions,
    riskAdjustedPerformance: evaluateRiskAdjustedPerformance([], { emitEvent: false }),
  }, { emitEvent: false, timestamp: '2026-07-13T12:06:00.000Z' })
  const realtimePaperOperations = evaluateRealtimePaperOperations({
    tenantContext,
    realtimeSignals,
    realtimeAlerts,
    realtimePaperDecisions,
    realtimePreparedTrades,
    realtimeSimulatedExecutions,
    realtimePortfolioReconciliation,
    realtimePaperPortfolio,
    realtimePaperRisk,
    realtimePaperPerformance,
  }, { emitEvent: false, timestamp: '2026-07-13T12:07:00.000Z' })
  return {
    portfolioRisk,
    drawdownProtection,
    realtimeSignals,
    realtimeAlerts,
    realtimePaperDecisions,
    realtimePreparedTrades,
    realtimeSimulatedExecutions,
    realtimePortfolioReconciliation,
    realtimePaperPortfolio,
    realtimePaperRisk,
    realtimePaperPerformance,
    realtimePaperOperations,
  }
}

describe('Phase 70A real-time paper risk monitor', () => {
  it('adds idempotent tenant-scoped persistence and parameterized repository access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_realtime_paper_risk_snapshots')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_realtime_paper_performance_snapshots')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_realtime_paper_operations_snapshots')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })

    for (const repositoryFactory of [createRealtimePaperRiskRepository, createRealtimePaperPerformanceRepository, createRealtimePaperOperationsRepository]) {
      const query = vi.fn(async () => ({ rows: [] }))
      const repository = repositoryFactory({ database: { connected: true, query } })
      await repository.create({ id: 'phase70-record', tenantContext, accountId: 'paper-portfolio', riskStatus: 'healthy', performanceStatus: 'healthy', operationsStatus: 'healthy' })
      await repository.list({ tenantContext, accountId: 'paper-portfolio', limit: 25 })
      expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
    }
  })

  it('monitors cash, exposure, drawdown, guardrail, and reconciliation status without live execution', () => {
    const result = lifecycle().realtimePaperRisk
    expect(result.eventType).toBe(PAPER_RISK_REALTIME_MONITORED_EVENT)
    expect(result.riskStatus).toBe('healthy')
    expect(result.realtimePaperRiskSnapshot.cashRiskSummary.status).toBe('healthy')
    expect(result.realtimePaperRiskSnapshot.latestReconciliationReference.eventType).toBe('paperPortfolio.realtime.reconciled')
    expect(result.paperTrading).toBe(true)
    expect(result.liveOrders).toBe(false)
    expect(result.brokerExecution).toBe(false)
  })

  it('blocks missing tenant context and elevates reconciliation mismatches', () => {
    const state = lifecycle()
    const blocked = monitorRealtimePaperRisk({ ...state, tenantContext: {}, accountId: 'paper-portfolio' }, { emitEvent: false })
    const elevated = monitorRealtimePaperRisk({
      ...state,
      tenantContext,
      accountId: 'paper-portfolio',
      realtimePortfolioReconciliation: { realtimePortfolioReconciliations: [{ id: 'mismatch', reconciliationStatus: 'mismatch', reconciliationIssues: ['cash mismatch'] }] },
    }, { emitEvent: false })
    expect(blocked.riskStatus).toBe('blocked')
    expect(elevated.riskStatus).toBe('elevated')
  })
})

describe('Phase 70B real-time paper performance stream', () => {
  it('streams performance from existing journal and portfolio snapshots', () => {
    const result = lifecycle().realtimePaperPerformance
    expect(result.eventType).toBe(PAPER_PERFORMANCE_REALTIME_UPDATED_EVENT)
    expect(result.performanceStatus).toBe('healthy')
    expect(result.realtimePaperPerformanceSummary.totalTrades).toBeGreaterThanOrEqual(1)
    expect(result.realtimePaperPerformanceSnapshot.latestJournalReferences.length).toBeGreaterThanOrEqual(1)
    expect(result.liveOrders).toBe(false)
    expect(result.brokerExecution).toBe(false)
  })

  it('marks stale performance when reconciliation timestamps exceed policy', () => {
    const state = lifecycle()
    const stale = streamRealtimePaperPerformance({
      tenantContext,
      accountId: 'paper-portfolio',
      realtimePaperPortfolio: state.realtimePaperPortfolio,
      realtimePortfolioReconciliation: state.realtimePortfolioReconciliation,
      realtimeSimulatedExecutions: state.realtimeSimulatedExecutions,
      streamingPolicy: { staleAfterMs: 1000 },
    }, { emitEvent: false, timestamp: '2026-07-13T12:30:00.000Z' })
    expect(stale.performanceStatus).toBe('stale')
  })
})

describe('Phase 70C real-time paper operations command center', () => {
  it('aggregates scanner, decision, guardrail, execution, reconciliation, portfolio, risk, and performance health', () => {
    const result = lifecycle().realtimePaperOperations
    expect(result.eventType).toBe(PAPER_OPERATIONS_REALTIME_EVALUATED_EVENT)
    expect(result.operationsStatus).toBe('healthy')
    expect(result.realtimePaperOperationsSections.map((item) => item.id)).toEqual([
      'scanner-alerts',
      'paper-decisions',
      'trade-preparation',
      'simulated-execution',
      'portfolio-reconciliation',
      'portfolio-stream',
      'risk-monitor',
      'performance-stream',
    ])
    expect(result.paperTrading).toBe(true)
    expect(result.liveOrders).toBe(false)
  })

  it('serves tenant-scoped APIs with viewer read-only, analyst write access, and cross-tenant denial', async () => {
    const state = lifecycle()
    const viewerOptions = {
      ...state,
      database: { connected: false },
      accountId: 'paper-portfolio',
      organizationMembershipRepository: membershipRepository('viewer'),
      env: { TRADING_MODE: 'paper' },
    }
    const riskRead = parseResponse(await createRealtimePaperRiskHandler(viewerOptions)(authEvent('GET', {}, 'viewer')))
    const performanceRead = parseResponse(await createRealtimePaperPerformanceHandler(viewerOptions)(authEvent('GET', {}, 'viewer')))
    const operationsRead = parseResponse(await createRealtimePaperOperationsHandler(viewerOptions)(authEvent('GET', {}, 'viewer')))
    const deniedWrite = parseResponse(await createRealtimePaperRiskHandler(viewerOptions)(authEvent('POST', { accountId: 'paper-portfolio' }, 'viewer')))
    const analystWrite = parseResponse(await createRealtimePaperOperationsHandler({ ...viewerOptions, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('POST', { accountId: 'paper-portfolio' }, 'analyst')))
    const crossTenant = parseResponse(await createRealtimePaperPerformanceHandler(viewerOptions)(authEvent('GET', {}, 'viewer', 'org-other')))

    expect([riskRead.statusCode, performanceRead.statusCode, operationsRead.statusCode]).toEqual([200, 200, 200])
    expect(deniedWrite.statusCode).toBe(403)
    expect(analystWrite.statusCode).toBe(200)
    expect(crossTenant.statusCode).toBe(403)
    expect(JSON.stringify({ risk: riskRead.json, performance: performanceRead.json, operations: operationsRead.json })).not.toMatch(/tokenHash|providerToken|password|authorization|apiKey|rawToken|credential/i)
  })
})
