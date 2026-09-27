import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { evaluatePaperCandidates } from '../lib/opportunities/paperEvaluation/paperEvaluationEngine.js'
import { simulateApprovedPaperEvaluations } from '../lib/opportunities/paperSimulation/paperSimulationEngine.js'
import { createCanonicalPaperLedgerRepository } from '../lib/opportunities/persistence/canonicalPaperLedgerRepository.js'

const NOW = '2026-09-26T14:00:00.000Z'
const OBSERVED = '2026-09-26T13:59:30.000Z'
const scope = { tenantContext: { organizationId: 'org-slice4b', teamWorkspaceId: 'team-slice4b', userId: 'user-slice4b' }, accountId: 'paper-portfolio', userId: 'user-slice4b' }
const portfolio = { id: 'paper-portfolio', cash: 100000, equity: 100000, buyingPower: 100000, positions: [] }
const portfolioRisk = { account: { accountValue: 100000, cash: 100000, buyingPower: 100000 }, summary: { openRisk: 0, openRiskPct: 0, drawdownPct: 0 } }

function provenance(overrides = {}) {
  return {
    provider: 'primary-market-provider', dataStatus: 'LIVE', freshness: 'FRESH',
    fallbackUsed: false, mock: false, delayed: false, observedAt: OBSERVED,
    receivedAt: '2026-09-26T13:59:31.000Z', sourceCount: 1, warningCodes: [], ...overrides,
  }
}

function candidate(overrides = {}) {
  return {
    opportunityId: 'opp-aapl', symbol: 'AAPL', strategyId: 'momentum', score: 86,
    band: 'STRONG', confidence: 82, qualityStatus: 'COMPLETE', blockers: [], missingInputs: [],
    freshness: 'FRESH', asOf: OBSERVED, engineVersion: 'trade-quality-v1', marketData: provenance(),
    orderContext: { assetType: 'equity', side: 'buy', orderType: 'market', price: 100, stopPrice: 98, targetPrice: 104, quantity: 10 },
    ...overrides,
  }
}

function regime(overrides = {}) {
  return {
    symbol: 'SPY', engineVersion: 'market-regime-v1', asOf: OBSERVED, freshness: 'FRESH',
    marketData: provenance(),
    classification: { trendRegime: 'BULL', volatilityRegime: 'NORMAL_VOLATILITY', riskRegime: 'RISK_ON', status: 'COMPLETE', confidence: 84 },
    ...overrides,
  }
}

const suitability = { engineVersion: 'adaptive-strategy-v1', strategies: [{ strategyId: 'momentum', decision: 'ENABLED', confidence: 82, blockingReasons: [] }] }

function evaluate({ candidate: suppliedCandidate = candidate(), regime: suppliedRegime = regime() } = {}) {
  return evaluatePaperCandidates({
    candidates: [suppliedCandidate], regime: suppliedRegime, strategySuitability: suitability,
    portfolioRisk: { maxDrawdown: 2 }, currentMarketEvidence: { symbol: 'SPY', price: 500 },
  }, { now: NOW })[0]
}

function executionQuote(overrides = {}) {
  return {
    symbol: 'AAPL', price: 100, bid: 99.98, ask: 100.02, bidSize: 10000, askSize: 10000,
    liquidityScore: 80, updatedAt: NOW,
    provenance: provenance({ observedAt: NOW, receivedAt: NOW }),
    ...overrides,
  }
}

function simulate(evaluation = evaluate(), quote = executionQuote()) {
  return simulateApprovedPaperEvaluations({
    evaluations: [evaluation], portfolio, portfolioRisk, enabled: true, executionQuotes: [quote],
  }, { now: NOW, confirmedAt: NOW, confirmationSource: 'authenticated_manual_request' }).results[0]
}

class EntryHarness {
  constructor() {
    this.connected = true
    this.transactionCalls = 0
    this.state = { accounts: [], positions: [], executions: [], accountingEvidence: [], riskLatches: [] }
  }

  async query(sql, params = []) { return this.run(this.state, sql, params) }

  async transaction(callback) {
    this.transactionCalls += 1
    const draft = structuredClone(this.state)
    const result = await callback({ query: (sql, params = []) => this.run(draft, sql, params) })
    this.state = draft
    return result
  }

  run(state, sql, params) {
    const text = sql.replace(/\s+/g, ' ').trim().toLowerCase()
    if (text.startsWith('insert into atlas_paper_accounts')) {
      const [id, organization_id, team_workspace_id, account_id, user_id, accounting_origin_id, balance] = params
      const row = { id, organization_id, team_workspace_id, account_id, user_id, accounting_origin_id, cash: balance, buying_power: balance, equity: balance, realized_pnl: 0, revision: 0, created_at: NOW, updated_at: NOW }
      state.accounts.push(row)
      return { rows: [row] }
    }
    if (text.startsWith('insert into atlas_paper_accounting_evidence')) {
      const row = { id: params[0], account_record_id: params[1], event_kind: params[7], amount: params[8], cash_before: params[9], cash_after: params[10], account_revision_before: params[11], account_revision_after: params[12], operation_idempotency_key: params[15], operation_index: params[16], actor_user_id: params[17], actor_role: params[18], authority_source: params[19], created_at: NOW }
      state.accountingEvidence.push(row)
      return { rows: [row] }
    }
    if (text.startsWith('insert into atlas_paper_risk_latches')) {
      const row = { account_record_id: params[0], organization_id: params[1], team_workspace_id: params[2], account_id: params[3], user_id: params[4], latch_state: 'CLEAR', reason: 'canonical_account_initialization', changed_by_user_id: 'system', changed_by_role: 'system', revision: 0, created_at: NOW, updated_at: NOW }
      state.riskLatches.push(row)
      return { rows: [] }
    }
    if (text.startsWith('select * from atlas_paper_accounts')) return { rows: state.accounts }
    if (text.startsWith('select * from atlas_paper_risk_latches')) return { rows: state.riskLatches }
    if (text.startsWith('select * from atlas_paper_executions')) return { rows: [] }
    if (text.includes('from atlas_ai_opportunity_analysis_history')) return { rows: [{ id: text.includes("analysis_category='paper_evaluation'") ? 'evaluation-record' : 'simulation-record' }] }
    if (text.startsWith('select * from atlas_paper_positions')) return { rows: state.positions }
    if (text.startsWith('insert into atlas_paper_executions')) {
      const row = { id: params[0], account_record_id: params[1], organization_id: params[2], team_workspace_id: params[3], account_id: params[4], user_id: params[5], position_id: params[6], execution_type: 'entry', idempotency_fingerprint: params[7], candidate_id: params[8], evaluation_id: params[9], execution_intent_id: params[10], strategy_id: params[11], symbol: params[12], asset_type: params[13], side: params[14], quantity: params[15], fill_price: params[16], fees: params[17], slippage_bps: params[18], cash_impact: params[19], realized_pnl_delta: 0, evidence_timestamp: params[20], engine_version: params[21], payload: params[22], created_at: NOW }
      state.executions.push(row)
      return { rows: [row] }
    }
    if (text.startsWith('update atlas_paper_accounts')) {
      const row = state.accounts[0]
      Object.assign(row, { cash: params[1], buying_power: params[2], equity: params[3], realized_pnl: params[4], revision: row.revision + 1, updated_at: NOW })
      return { rows: [row] }
    }
    if (text.startsWith('insert into atlas_paper_positions')) {
      const row = { id: params[0], account_record_id: params[1], organization_id: params[2], team_workspace_id: params[3], account_id: params[4], user_id: params[5], symbol: params[6], asset_type: params[7], side: params[8], quantity: params[9], average_cost: params[10], current_price: params[11], mark_evidence_timestamp: params[12], risk_state: params[13], realized_pnl: params[14], originating_candidate_id: params[15], originating_evaluation_id: params[16], originating_intent_fingerprint: params[17], strategy_id: params[18], status: 'open', revision: 0, created_at: NOW, updated_at: NOW }
      state.positions.push(row)
      return { rows: [row] }
    }
    throw new Error(`Unhandled Slice 4B test SQL: ${text}`)
  }
}

describe('Phase 2 Slice 4B current-market provenance contract', () => {
  it('keeps valid LIVE, primary, fresh evidence eligible through canonical PAPER commit', async () => {
    const evaluation = evaluate()
    expect(evaluation).toMatchObject({ status: 'APPROVED_FOR_PAPER_REVIEW', currentMarketEvidence: { candidate: { dataStatus: 'LIVE', fallbackUsed: false, mock: false }, regime: { dataStatus: 'LIVE', fallbackUsed: false, mock: false } } })
    const simulation = simulate(evaluation)
    expect(simulation).toMatchObject({ status: 'SIMULATED_FILLED', paperTradingOnly: true, liveOrders: false, brokerExecution: false, executionRealism: { paperSimulationAdmissibility: { status: 'ADMISSIBLE' }, quoteEvidence: { dataStatus: 'LIVE', fallbackUsed: false, mock: false } } })
    const database = new EntryHarness()
    const committed = await createCanonicalPaperLedgerRepository({ database }).commitEntry({ ...scope, simulation })
    expect(committed).toMatchObject({ duplicate: false, account: { revision: 1 }, position: { symbol: 'AAPL', status: 'open' } })
    expect(database.state).toMatchObject({ accounts: [{ revision: 1 }], positions: [{ symbol: 'AAPL' }], executions: [{ execution_type: 'entry' }] })
  })

  it('PA.1 rejects explicitly non-LIVE regime evidence with an explicit reason', () => {
    const result = evaluate({ regime: regime({ marketData: provenance({ dataStatus: 'DEGRADED' }) }) })
    expect(result.status).not.toBe('APPROVED_FOR_PAPER_REVIEW')
    expect(result.missingEvidence).toContain('regime:current_market_status_not_live')
    expect(result.reasons.join(' ')).toMatch(/provenance rejected.*status not live/i)
  })

  it.each([
    ['stale', provenance({ observedAt: '2026-09-26T13:40:00.000Z', receivedAt: '2026-09-26T13:40:01.000Z' }), /stale/],
    ['fallback', provenance({ fallbackUsed: true }), /fallback/],
    ['mock', provenance({ provider: 'mock-feed', mock: true, dataStatus: 'MOCK' }), /mock/],
    ['malformed receipt', provenance({ receivedAt: 'not-a-timestamp' }), /received_at_malformed/],
  ])('PA.1 rejects %s current-market evidence', (_name, marketData, reason) => {
    const result = evaluate({ candidate: candidate({ marketData }) })
    expect(result.status).not.toBe('APPROVED_FOR_PAPER_REVIEW')
    expect(result.missingEvidence.join(' ')).toMatch(reason)
  })

  it('PA.2 cannot be upgraded by caller-like flattened provenance assertions', () => {
    const quote = executionQuote({
      provider: 'claimed-live-provider', dataStatus: 'LIVE', fallbackUsed: false, mock: false,
      provenance: provenance({ provider: 'mock-fallback', dataStatus: 'DEGRADED', fallbackUsed: true, mock: true }),
    })
    const result = simulate(evaluate(), quote)
    expect(result.status).toBe('INSUFFICIENT_EXECUTION_EVIDENCE')
    expect(result.executionRealism.missingEvidence).toEqual(expect.arrayContaining([
      'execution_quote:current_market_mock_identity', 'execution_quote:current_market_status_not_live',
      'execution_quote:current_market_fallback_not_explicitly_false', 'execution_quote:current_market_mock_not_explicitly_false',
    ]))
    expect(result.executionFill).toBeNull()
  })

  it.each([
    ['malformed receivedAt', provenance({ observedAt: NOW, receivedAt: '09/26/2026 14:00' }), 'execution_quote:current_market_received_at_malformed'],
    ['explicit degraded status', provenance({ observedAt: NOW, receivedAt: NOW, dataStatus: 'DEGRADED' }), 'execution_quote:current_market_status_not_live'],
    ['missing provider/source', provenance({ observedAt: NOW, receivedAt: NOW, provider: null }), 'execution_quote:current_market_provider_or_source_missing'],
  ])('PA.2 rejects %s independently', (_name, quoteProvenance, reason) => {
    const result = simulate(evaluate(), executionQuote({ provenance: quoteProvenance }))
    expect(result.status).toBe('INSUFFICIENT_EXECUTION_EVIDENCE')
    expect(result.executionRealism.missingEvidence).toContain(reason)
    expect(result.executionFill).toBeNull()
  })

  it('canonical commit rejects corrupt provenance despite ADMISSIBLE and performs zero financial mutation', async () => {
    const simulation = structuredClone(simulate())
    simulation.executionRealism.quoteEvidence.dataStatus = 'DEGRADED'
    expect(simulation.executionRealism.paperSimulationAdmissibility.status).toBe('ADMISSIBLE')
    const database = new EntryHarness()
    await expect(createCanonicalPaperLedgerRepository({ database }).commitEntry({ ...scope, simulation })).rejects.toMatchObject({ code: 'paper_ledger_evidence_missing' })
    expect(database.transactionCalls).toBe(0)
    expect(database.state).toEqual({ accounts: [], positions: [], executions: [], accountingEvidence: [], riskLatches: [] })
  })

  it('introduces no PA.4 provider qualification, durable data-health latch, or live/broker authority', () => {
    const contract = readFileSync('lib/market/currentMarketEvidenceContract.js', 'utf8')
    const ledger = readFileSync('lib/opportunities/persistence/canonicalPaperLedgerRepository.js', 'utf8')
    const simulation = simulate()
    expect(contract).not.toMatch(/qualifiedProvider|providerAllowlist|PA\.4|calendar/i)
    expect(`${contract}\n${ledger}`).not.toMatch(/data.health.latch|provider.health.latch|dataHealthLatch/i)
    expect(simulation).toMatchObject({ paperTradingOnly: true, liveOrders: false, brokerExecution: false, automaticExecution: false })
    expect(JSON.stringify(simulation)).not.toContain('liveTradingApproved":true')
  })
})
