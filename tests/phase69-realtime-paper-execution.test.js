import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { evaluateRealtimePaperDecisions, createRealtimePaperDecisionRepository, PAPER_DECISION_REALTIME_EVALUATED_EVENT } from '../lib/trading/realTimePaperDecisionCoordinator.js'
import { prepareRealtimePaperTrades, createRealtimePreparedTradeRepository, PAPER_TRADE_REALTIME_PREPARED_EVENT, PAPER_TRADE_REALTIME_GUARDRAIL_EVALUATED_EVENT } from '../lib/trading/realTimePaperTradePreparationCoordinator.js'
import { simulateRealtimePaperExecution, createRealtimeSimulatedExecutionRepository, PAPER_EXECUTION_REALTIME_SIMULATED_EVENT, PAPER_ACCOUNTING_REALTIME_UPDATED_EVENT, PAPER_JOURNAL_REALTIME_RECORDED_EVENT } from '../lib/trading/realTimeSimulatedExecutionCoordinator.js'
import { evaluatePortfolioRisk } from '../src/core/risk/portfolioRiskEngine.js'
import { evaluateDrawdownProtection } from '../src/core/risk/drawdownProtectionEngine.js'
import { recommendCapitalAllocation } from '../src/core/analytics/capitalAllocationEngine.js'
import { createRealtimePaperDecisionsHandler } from '../netlify/functions/realtime-paper-decisions.js'
import { createRealtimePreparedTradesHandler } from '../netlify/functions/realtime-prepared-trades.js'
import { createRealtimeSimulatedExecutionsHandler } from '../netlify/functions/realtime-simulated-executions.js'
import { createRealtimePaperExecutionOperationsHealthHandler } from '../netlify/functions/realtime-paper-execution-operations-health.js'

const userId = 'local-development:local-operator'
const tenantContext = { organizationId: 'org-atlas-local', teamWorkspaceId: null, userId, role: 'analyst' }
const portfolio = { id: 'paper-portfolio', cash: 100000, accountValue: 100000, buyingPower: 100000, positions: [] }
const tradeTemplate = { id: 'paper-trade-rt-1', symbol: 'SPY', assetType: 'etf', side: 'buy', orderType: 'market', quantity: 5, price: 100, stopPrice: 98, paperTrading: true }

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
      'x-request-id': 'req-phase69',
      'x-atlas-dev-role': role,
      'x-atlas-dev-subject': 'local-operator',
    },
    queryStringParameters: { organizationId, limit: '25' },
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

function realtimeSignalsFixture() {
  return {
    eventType: 'signal.realtime.evaluated',
    realtimeSignalEvaluations: [{
      id: 'realtime-signal-spy-1',
      tenantScope: tenantContext,
      symbol: 'SPY',
      assetType: 'etf',
      signalStatus: 'qualified',
      signalConfidence: 94,
      signalAction: 'BUY',
      signalRationale: 'Qualified real-time paper signal.',
      sourceEventReferences: [{ id: 'route-1', eventType: 'marketData.streamingEvent.routed' }],
      scannerCandidateReference: { id: 'candidate-1', eventType: 'scanner.realtime.evaluated' },
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    }],
    realtimeSignalSummary: { qualified: 1, watchlist: 0, rejected: 0 },
  }
}

function contextFixture() {
  const portfolioRisk = evaluatePortfolioRisk(portfolio, { emitEvent: false })
  const drawdownProtection = evaluateDrawdownProtection(portfolio, [], { emitEvent: false })
  const capitalAllocation = recommendCapitalAllocation(portfolio, {
    emitEvent: false,
    riskSnapshot: portfolioRisk,
    drawdownProtection,
  })
  return {
    tenantContext,
    portfolio,
    portfolioRisk,
    drawdownProtection,
    capitalAllocation,
    researchEnhancedDecision: { eventType: 'ai.decision.researchEnhanced', finalDecision: 'approved' },
    marketRegimeClassification: { eventType: 'market.regime.classified', compositeRegimeLabel: 'risk-on uptrend' },
    strategyLifecycle: { eventType: 'strategy.lifecycle.updated', lifecycleState: 'active' },
    strategyRegistry: { eventType: 'strategy.registry.updated', registryStatus: 'active' },
    quote: { last: 100, bid: 100, ask: 100, high: 101, low: 99, liquidityScore: 90 },
    tradeTemplate,
  }
}

function fullLifecycle() {
  const context = contextFixture()
  const realtimePaperDecisions = evaluateRealtimePaperDecisions({ ...context, realtimeSignals: realtimeSignalsFixture() }, { emitEvent: false, timestamp: '2026-07-13T11:00:00.000Z' })
  const realtimePreparedTrades = prepareRealtimePaperTrades({ ...context, realtimePaperDecisions }, { emitEvent: false, timestamp: '2026-07-13T11:01:00.000Z' })
  const realtimeSimulatedExecutions = simulateRealtimePaperExecution({ ...context, realtimePreparedTrades }, { emitEvent: false, timestamp: '2026-07-13T11:02:00.000Z' })
  return { ...context, realtimePaperDecisions, realtimePreparedTrades, realtimeSimulatedExecutions }
}

describe('Phase 69A real-time paper decision coordinator', () => {
  it('adds idempotent persistence and parameterized repository access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_realtime_paper_decisions')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_realtime_prepared_trades')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_realtime_simulated_executions')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [] }))
    const decisionRepository = createRealtimePaperDecisionRepository({ database: { connected: true, query } })
    await decisionRepository.create({ id: 'decision-1', tenantContext, symbol: 'SPY', decisionStatus: 'approved', decisionConfidence: 90 })
    await decisionRepository.list({ tenantContext, decisionStatus: 'approved', symbol: 'SPY' })
    const preparedRepository = createRealtimePreparedTradeRepository({ database: { connected: true, query } })
    await preparedRepository.create({ id: 'prepared-1', tenantContext, symbol: 'SPY', preparationStatus: 'ready', proposedPaperTrade: tradeTemplate })
    await preparedRepository.list({ tenantContext, preparationStatus: 'ready', symbol: 'SPY' })
    const executionRepository = createRealtimeSimulatedExecutionRepository({ database: { connected: true, query } })
    await executionRepository.create({ id: 'execution-1', tenantContext, symbol: 'SPY', executionLifecycleStatus: 'simulated' })
    await executionRepository.list({ tenantContext, executionStatus: 'simulated', symbol: 'SPY' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('evaluates qualified signals with AI, research, market, risk, allocation, and strategy references', () => {
    const lifecycle = fullLifecycle()
    const decisions = lifecycle.realtimePaperDecisions
    expect(decisions.eventType).toBe(PAPER_DECISION_REALTIME_EVALUATED_EVENT)
    expect(decisions.realtimePaperDecisionSummary.approved).toBe(1)
    expect(decisions.realtimePaperDecisions[0].researchEnhancedDecisionReference.eventType).toBe('ai.decision.researchEnhanced')
    expect(decisions.liveOrders).toBe(false)
    expect(decisions.brokerExecution).toBe(false)
  })

  it('rejects stale, duplicate, incomplete, and live-mode signal context before preparation', () => {
    const context = contextFixture()
    const staleSignals = {
      realtimeSignalEvaluations: [{
        ...realtimeSignalsFixture().realtimeSignalEvaluations[0],
        id: 'stale-signal',
        stale: true,
      }],
    }
    const rejected = evaluateRealtimePaperDecisions({ ...context, realtimeSignals: staleSignals, paperTrading: false }, { emitEvent: false })
    expect(rejected.realtimePaperDecisionSummary.rejected).toBe(1)
    expect(rejected.realtimePaperDecisions[0].rejectionReasons).toContain('paper-mode invariant')
  })
})

describe('Phase 69B real-time position sizing and guardrail coordinator', () => {
  it('prepares proposed paper trades through sizing, capital, drawdown, cash, heat, and guardrail checks', () => {
    const lifecycle = fullLifecycle()
    const prepared = lifecycle.realtimePreparedTrades
    expect(prepared.eventType).toBe(PAPER_TRADE_REALTIME_PREPARED_EVENT)
    expect(prepared.realtimeGuardrailEvaluations[0].eventType).toBe(PAPER_TRADE_REALTIME_GUARDRAIL_EVALUATED_EVENT)
    expect(prepared.realtimePreparedTradeSummary.ready).toBe(1)
    expect(prepared.realtimePreparedTrades[0].proposedPaperTrade.paperTrading).toBe(true)
    expect(prepared.realtimePreparedTrades[0].buyingPowerValidation.status).toBe('passed')
  })

  it('defaults blocked when required risk context is missing', () => {
    const context = contextFixture()
    const realtimePaperDecisions = evaluateRealtimePaperDecisions({ ...context, realtimeSignals: realtimeSignalsFixture() }, { emitEvent: false })
    const prepared = prepareRealtimePaperTrades({
      tenantContext,
      realtimePaperDecisions,
      portfolio,
      portfolioRisk: context.portfolioRisk,
      tradeTemplate,
      quote: context.quote,
    }, { emitEvent: false })
    expect(prepared.realtimePreparedTradeSummary.blocked).toBe(1)
    expect(prepared.realtimePreparedTrades[0].preparationBlockers).toContain('capital allocation reference is missing')
  })
})

describe('Phase 69C real-time simulated execution lifecycle', () => {
  it('simulates only approved prepared paper trades and records accounting and journal updates for filled trades', () => {
    const lifecycle = fullLifecycle()
    const simulated = lifecycle.realtimeSimulatedExecutions
    expect(simulated.eventType).toBe(PAPER_EXECUTION_REALTIME_SIMULATED_EVENT)
    expect(simulated.realtimeSimulatedExecutionSummary.simulated).toBe(1)
    expect(simulated.realtimeAccountingUpdates[0].eventType).toBe(PAPER_ACCOUNTING_REALTIME_UPDATED_EVENT)
    expect(simulated.realtimeJournalRecords[0].eventType).toBe(PAPER_JOURNAL_REALTIME_RECORDED_EVENT)
    const duplicate = simulateRealtimePaperExecution({
      ...lifecycle,
      existingExecutions: simulated.realtimeSimulatedExecutions,
    }, { emitEvent: false })
    expect(duplicate.realtimeSimulatedExecutionSummary.total).toBe(0)
    expect(duplicate.realtimeSimulatedExecutionSummary.duplicateSuppressed).toBe(1)
  })

  it('serves tenant-scoped APIs with viewer read-only, analyst paper operation access, and cross-tenant denial', async () => {
    const lifecycle = fullLifecycle()
    const viewerOptions = { ...lifecycle, repositoryFactory, organizationMembershipRepository: membershipRepository('viewer'), env: { TRADING_MODE: 'paper' } }
    const decisions = parseResponse(await createRealtimePaperDecisionsHandler(viewerOptions)(authEvent('GET', {}, 'viewer')))
    const prepared = parseResponse(await createRealtimePreparedTradesHandler(viewerOptions)(authEvent('GET', {}, 'viewer')))
    const executions = parseResponse(await createRealtimeSimulatedExecutionsHandler(viewerOptions)(authEvent('GET', {}, 'viewer')))
    const operations = parseResponse(await createRealtimePaperExecutionOperationsHealthHandler(viewerOptions)(authEvent('GET', {}, 'viewer')))
    const deniedWrite = parseResponse(await createRealtimeSimulatedExecutionsHandler(viewerOptions)(authEvent('POST', { execution: {} }, 'viewer')))
    const analystWrite = parseResponse(await createRealtimeSimulatedExecutionsHandler({ ...viewerOptions, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('POST', { execution: { id: 'execution-post-1', symbol: 'SPY', executionLifecycleStatus: 'simulated' } }, 'analyst')))
    const crossTenant = parseResponse(await createRealtimePaperDecisionsHandler(viewerOptions)(authEvent('GET', {}, 'viewer', 'org-other')))
    expect([decisions.statusCode, prepared.statusCode, executions.statusCode, operations.statusCode]).toEqual([200, 200, 200, 200])
    expect(deniedWrite.statusCode).toBe(403)
    expect(analystWrite.statusCode).toBe(200)
    expect(crossTenant.statusCode).toBe(403)
    expect(JSON.stringify({ decisions: decisions.json, prepared: prepared.json, executions: executions.json })).not.toMatch(/tokenHash|providerToken|password|authorization|apiKey|rawToken|credential/i)
  })
})
