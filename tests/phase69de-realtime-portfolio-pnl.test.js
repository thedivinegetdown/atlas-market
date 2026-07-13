import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { evaluateRealtimePaperDecisions } from '../lib/trading/realTimePaperDecisionCoordinator.js'
import { prepareRealtimePaperTrades } from '../lib/trading/realTimePaperTradePreparationCoordinator.js'
import { simulateRealtimePaperExecution } from '../lib/trading/realTimeSimulatedExecutionCoordinator.js'
import { createRealtimePortfolioReconciliationRepository, reconcileRealtimePortfolio, PAPER_PORTFOLIO_REALTIME_RECONCILED_EVENT } from '../lib/trading/realTimePortfolioReconciliationEngine.js'
import { streamRealtimePaperPortfolio, PAPER_PORTFOLIO_REALTIME_UPDATED_EVENT } from '../lib/trading/realTimePortfolioStreamingEngine.js'
import { evaluatePortfolioRisk } from '../src/core/risk/portfolioRiskEngine.js'
import { evaluateDrawdownProtection } from '../src/core/risk/drawdownProtectionEngine.js'
import { recommendCapitalAllocation } from '../src/core/analytics/capitalAllocationEngine.js'
import { evaluatePortfolioAnalytics } from '../src/core/analytics/portfolioAnalyticsEngine.js'
import { createRealtimePortfolioReconciliationHandler } from '../netlify/functions/realtime-portfolio-reconciliation.js'
import { createRealtimePaperPortfolioHandler } from '../netlify/functions/realtime-paper-portfolio.js'
import { createRealtimePnlHandler } from '../netlify/functions/realtime-pnl.js'
import { createPortfolioReconciliationHealthHandler } from '../netlify/functions/portfolio-reconciliation-health.js'

const userId = 'local-development:local-operator'
const tenantContext = { organizationId: 'org-atlas-local', teamWorkspaceId: null, userId, role: 'analyst' }
const portfolio = { id: 'paper-portfolio', cash: 100000, accountValue: 100000, buyingPower: 100000, positions: [] }
const tradeTemplate = { id: 'paper-trade-rt-pnl-1', symbol: 'SPY', assetType: 'etf', side: 'buy', orderType: 'market', quantity: 5, price: 100, stopPrice: 98, paperTrading: true }

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
      'x-request-id': 'req-phase69de',
      'x-atlas-dev-role': role,
      'x-atlas-dev-subject': 'local-operator',
    },
    queryStringParameters: { organizationId, accountId: 'paper-portfolio', limit: '25' },
    body: method === 'POST' ? JSON.stringify(body) : '',
  }
}

function repositoryFactory() {
  return { connected: false, getStore: vi.fn(() => ({ listScoped: vi.fn(async () => []) })), end: vi.fn(async () => {}) }
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
    realtimeSignalEvaluations: [{
      id: 'realtime-signal-spy-pnl-1',
      tenantScope: tenantContext,
      symbol: 'SPY',
      assetType: 'etf',
      signalStatus: 'qualified',
      signalConfidence: 94,
      signalAction: 'BUY',
      sourceEventReferences: [{ id: 'route-1', eventType: 'marketData.streamingEvent.routed' }],
      scannerCandidateReference: { id: 'candidate-1', eventType: 'scanner.realtime.evaluated' },
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    }],
  }
  const realtimePaperDecisions = evaluateRealtimePaperDecisions({
    tenantContext,
    realtimeSignals,
    researchEnhancedDecision: { eventType: 'ai.decision.researchEnhanced', finalDecision: 'approved' },
    marketRegimeClassification: { eventType: 'market.regime.classified', compositeRegimeLabel: 'risk-on uptrend' },
    portfolioRisk,
    drawdownProtection,
    capitalAllocation,
    strategyLifecycle: { eventType: 'strategy.lifecycle.updated', lifecycleState: 'active' },
    strategyRegistry: { eventType: 'strategy.registry.updated', registryStatus: 'active' },
  }, { emitEvent: false })
  const realtimePreparedTrades = prepareRealtimePaperTrades({
    tenantContext,
    realtimePaperDecisions,
    portfolio,
    portfolioRisk,
    drawdownProtection,
    capitalAllocation,
    tradeTemplate,
    quote: { last: 100, bid: 100, ask: 100, high: 101, low: 99, liquidityScore: 90 },
  }, { emitEvent: false })
  const realtimeSimulatedExecutions = simulateRealtimePaperExecution({
    tenantContext,
    realtimePreparedTrades,
    portfolio,
    quote: { last: 100, bid: 100, ask: 100, high: 101, low: 99, liquidityScore: 90 },
  }, { emitEvent: false })
  const realtimePortfolioReconciliation = reconcileRealtimePortfolio({
    tenantContext,
    accountId: 'paper-portfolio',
    realtimeSimulatedExecutions,
  }, { emitEvent: false, timestamp: '2026-07-13T11:30:00.000Z' })
  const realtimePaperPortfolio = streamRealtimePaperPortfolio({
    tenantContext,
    accountId: 'paper-portfolio',
    realtimePortfolioReconciliation,
    portfolioAnalytics: evaluatePortfolioAnalytics(portfolio, { emitEvent: false, riskSnapshot: portfolioRisk }),
    portfolioRisk,
  }, { emitEvent: false, timestamp: '2026-07-13T11:31:00.000Z' })
  return { portfolioRisk, realtimeSimulatedExecutions, realtimePortfolioReconciliation, realtimePaperPortfolio }
}

describe('Phase 69D real-time portfolio reconciliation', () => {
  it('adds idempotent persistence and parameterized reconciliation repository access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_realtime_portfolio_reconciliations')
    expect(sql).toContain('idx_atlas_realtime_portfolio_reconciliations_status')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createRealtimePortfolioReconciliationRepository({ database: { connected: true, query } })
    await repository.create({ id: 'recon-1', tenantContext, accountId: 'paper-portfolio', reconciliationStatus: 'reconciled' })
    await repository.list({ tenantContext, accountId: 'paper-portfolio', reconciliationStatus: 'reconciled' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('reconciles successful simulated fills without independently recalculating accounting rules', () => {
    const result = lifecycle().realtimePortfolioReconciliation
    expect(result.eventType).toBe(PAPER_PORTFOLIO_REALTIME_RECONCILED_EVENT)
    expect(result.reconciliationStatus).toBe('reconciled')
    expect(result.realtimePortfolioReconciliationSummary.reconciled).toBe(1)
    expect(result.realtimePortfolioReconciliations[0].cashReconciliation.status).toBe('reconciled')
    expect(result.realtimePortfolioReconciliations[0].positionsSnapshot.length).toBeGreaterThan(0)
  })

  it('blocks missing tenant/account context, suppresses duplicate fills, and ignores rejected executions', () => {
    const { realtimeSimulatedExecutions, realtimePortfolioReconciliation } = lifecycle()
    const blocked = reconcileRealtimePortfolio({ tenantContext, realtimeSimulatedExecutions }, { emitEvent: false })
    const duplicate = reconcileRealtimePortfolio({
      tenantContext,
      accountId: 'paper-portfolio',
      realtimeSimulatedExecutions,
      existingReconciliations: realtimePortfolioReconciliation.realtimePortfolioReconciliations,
    }, { emitEvent: false })
    const rejectedOnly = reconcileRealtimePortfolio({
      tenantContext,
      accountId: 'paper-portfolio',
      executions: [{ id: 'rejected-execution', executionLifecycleStatus: 'rejected' }],
    }, { emitEvent: false })
    expect(blocked.reconciliationStatus).toBe('blocked')
    expect(duplicate.realtimePortfolioReconciliationSummary.duplicateFillsSuppressed).toBe(1)
    expect(rejectedOnly.realtimePortfolioReconciliationSummary.rejectedExecutionsIgnored).toBe(1)
    expect(rejectedOnly.realtimePortfolioReconciliationSummary.total).toBe(0)
  })

  it('surfaces reconciliation mismatches safely', () => {
    const { realtimeSimulatedExecutions } = lifecycle()
    const mismatch = reconcileRealtimePortfolio({
      tenantContext,
      accountId: 'paper-portfolio',
      realtimeSimulatedExecutions,
      expectedAccountState: { cash: 1, equity: 1, realizedPnl: 999 },
    }, { emitEvent: false })
    expect(mismatch.reconciliationStatus).toBe('mismatch')
    expect(mismatch.realtimePortfolioReconciliations[0].reconciliationIssues.length).toBeGreaterThan(0)
  })
})

describe('Phase 69E real-time portfolio and P&L streaming', () => {
  it('streams cash, equity, positions, P&L, exposure references, and latest reconciliation state', () => {
    const stream = lifecycle().realtimePaperPortfolio
    expect(stream.eventType).toBe(PAPER_PORTFOLIO_REALTIME_UPDATED_EVENT)
    expect(stream.streamingPortfolioStatus).toBe('healthy')
    expect(stream.currentCashSummary.cash).toBeLessThan(100000)
    expect(stream.currentEquitySummary.equity).toBeGreaterThan(0)
    expect(stream.openPositionsSummary.totalOpenPositions).toBe(1)
    expect(stream.exposureSummaryReferences.grossExposure).toBeGreaterThan(0)
    expect(stream.liveOrders).toBe(false)
    expect(stream.brokerExecution).toBe(false)
  })

  it('serves tenant-scoped APIs with viewer read-only, analyst reconciliation access, and cross-tenant denial', async () => {
    const state = lifecycle()
    const viewerOptions = { ...state, repositoryFactory, organizationMembershipRepository: membershipRepository('viewer'), accountId: 'paper-portfolio', env: { TRADING_MODE: 'paper' } }
    const reconciliation = parseResponse(await createRealtimePortfolioReconciliationHandler(viewerOptions)(authEvent('GET', {}, 'viewer')))
    const portfolioResponse = parseResponse(await createRealtimePaperPortfolioHandler(viewerOptions)(authEvent('GET', {}, 'viewer')))
    const pnl = parseResponse(await createRealtimePnlHandler(viewerOptions)(authEvent('GET', {}, 'viewer')))
    const health = parseResponse(await createPortfolioReconciliationHealthHandler(viewerOptions)(authEvent('GET', {}, 'viewer')))
    const deniedWrite = parseResponse(await createRealtimePortfolioReconciliationHandler(viewerOptions)(authEvent('POST', { accountId: 'paper-portfolio' }, 'viewer')))
    const analystWrite = parseResponse(await createRealtimePortfolioReconciliationHandler({ ...viewerOptions, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('POST', { accountId: 'paper-portfolio', realtimeSimulatedExecutions: state.realtimeSimulatedExecutions }, 'analyst')))
    const crossTenant = parseResponse(await createRealtimePaperPortfolioHandler(viewerOptions)(authEvent('GET', {}, 'viewer', 'org-other')))
    expect([reconciliation.statusCode, portfolioResponse.statusCode, pnl.statusCode, health.statusCode]).toEqual([200, 200, 200, 200])
    expect(deniedWrite.statusCode).toBe(403)
    expect(analystWrite.statusCode).toBe(200)
    expect(crossTenant.statusCode).toBe(403)
    expect(JSON.stringify({ reconciliation: reconciliation.json, portfolio: portfolioResponse.json, pnl: pnl.json })).not.toMatch(/tokenHash|providerToken|password|authorization|apiKey|rawToken|credential/i)
  })
})
