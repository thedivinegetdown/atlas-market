import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import {
  createCanonicalPaperLedgerRepository,
  resolveCanonicalPaperLedgerRepository,
  DEFAULT_INITIAL_PAPER_BALANCE,
} from '../lib/opportunities/persistence/canonicalPaperLedgerRepository.js'
import { createDatabaseAdapter } from '../lib/db/postgresRepository.js'
import { runMigrations } from '../lib/db/migrations.js'
import { createPaperRiskLatchActionHandler } from '../netlify/functions/paper-risk-latch-action.js'
import { createIndexPullbackExitPolicy } from '../lib/opportunities/forwardTest/indexPullbackExitPolicy.js'
import { buildCanonicalPaperOutcomes } from '../lib/analytics/canonicalPaperOutcomes.js'
import { exitEvidenceFixture } from './helpers/exitEvidenceFixtures.js'

const now = '2026-08-13T12:00:00.000Z'
const scope = (overrides = {}) => ({
  tenantContext: { organizationId: 'org-a', teamWorkspaceId: 'team-a', userId: 'user-a' },
  accountId: 'paper-portfolio',
  userId: 'user-a',
  ...overrides,
})

function entry(overrides = {}) {
  const simulation = {
    status: 'SIMULATED_FILLED', fingerprint: 'entry-fp-1', evaluationId: 'eval-1',
    evaluationEvidenceFingerprint: 'eval-evidence-1', candidateId: 'candidate-1',
    symbol: 'AAPL', strategyId: 'momentum', simulatedAt: now,
    orderPlan: { evidenceTimestamp: now, side: 'buy', entryType: 'market', referencePrice: 100, stopReference: 98, maximumRisk: 20 }, engineVersion: 'guarded-paper-simulation-v3',
    executionFill: { symbol: 'AAPL', assetType: 'equity', side: 'buy', quantity: 10, referencePrice: 100, fillPrice: 100, fees: 1, slippageBps: 2, cashImpact: -1001 },
    journal: { journalStatus: 'recorded' }, tradeQuality: { score: 85, band: 'STRONG' },
    regime: { trendRegime: 'BULL' }, evaluationStatus: 'APPROVED_FOR_PAPER_REVIEW',
    executionCalibrationStatus: 'PAPER_ONLY_NOT_LIVE_CALIBRATED', paperTradingOnly: true, liveOrders: false, brokerExecution: false,
    ...overrides,
  }
  const fill = simulation.executionFill
  const referencePrice = fill.referencePrice ?? fill.fillPrice
  const executableSide = fill.side === 'buy' || fill.side === 'cover' ? 'ask' : 'bid'
  return { ...simulation, executionFill: { ...fill, referencePrice }, executionRealism: simulation.executionRealism ?? {
    version: 'paper-execution-realism-v2', executionCalibrationStatus: 'PAPER_ONLY_NOT_LIVE_CALIBRATED',
    paperSimulationAdmissibility: { status: 'ADMISSIBLE' }, liveExecutionCalibration: { status: 'NOT_CALIBRATED', liveMoneyReady: false },
    chronology: { decisionAt: now, confirmedAt: now, submittedAt: now, decisionToConfirmationMs: 0, confirmationToSubmissionMs: 0 },
    quoteEvidence: { bid: executableSide === 'bid' ? referencePrice : referencePrice - 0.02, ask: executableSide === 'ask' ? referencePrice : referencePrice + 0.02, observedAt: now },
    quantityEvidence: { requestedQuantity: fill.quantity, executableSide, displayedSize: fill.quantity, fullQuantityDisplayed: true },
    fillEvidence: { status: 'PAPER_FILLED', requestedQuantity: fill.quantity, filledQuantity: fill.quantity, referencePrice, fillPrice: fill.fillPrice, slippageBps: fill.slippageBps, fees: fill.fees, costApplications: { spread: 1, slippage: 1, fees: 1 } },
  } }
}

class PaperPgHarness {
  constructor() {
    this.connected = true
    this.state = { accounts: [], positions: [], executions: [], riskLatches: [], riskLatchAudit: [] }
    this.failPattern = null
    this.evidenceAvailable = true
    this.queue = Promise.resolve()
  }
  async query(sql, params = []) { return this.#run(this.state, sql, params) }
  async transaction(callback) {
    const execute = async () => {
      const draft = structuredClone(this.state)
      const client = { query: (sql, params = []) => this.#run(draft, sql, params) }
      const result = await callback(client)
      this.state = draft
      return result
    }
    const current = this.queue.then(execute, execute)
    this.queue = current.catch(() => {})
    return current
  }
  #run(state, sql, params) {
    const text = sql.replace(/\s+/g, ' ').trim().toLowerCase()
    if (this.failPattern && text.includes(this.failPattern)) {
      const pattern = this.failPattern
      this.failPattern = null
      throw new Error(`injected database failure at ${pattern}`)
    }
    if (text.startsWith('insert into atlas_paper_accounts')) {
      const [id, organization_id, team_workspace_id, account_id, user_id, balance] = params
      let inserted = null
      if (!state.accounts.some(x => x.organization_id === organization_id && x.team_workspace_id === team_workspace_id && x.account_id === account_id && x.user_id === user_id)) {
        inserted = { id, organization_id, team_workspace_id, account_id, user_id, cash: balance, buying_power: balance, equity: balance, realized_pnl: 0, revision: 0, created_at: now, updated_at: now }
        state.accounts.push(inserted)
      }
      return { rows: inserted ? [{ id }] : [] }
    }
    if (text.startsWith('insert into atlas_paper_risk_latches')) {
      const [account_record_id, organization_id, team_workspace_id, account_id, user_id] = params
      const actionInsert = params.length > 5
      const row = {
        account_record_id, organization_id, team_workspace_id, account_id, user_id,
        latch_state: actionInsert ? 'BLOCKED' : 'CLEAR',
        reason: actionInsert ? params[5] : 'canonical_account_initialization',
        changed_by_user_id: actionInsert ? params[6] : 'system',
        changed_by_role: actionInsert ? params[7] : 'system',
        revision: 0, created_at: now, updated_at: now,
      }
      state.riskLatches.push(row)
      return { rows: actionInsert ? [row] : [] }
    }
    if (text.startsWith('select * from atlas_paper_risk_latches')) {
      const [account_record_id, organization_id, team_workspace_id, account_id, user_id] = params
      return { rows: state.riskLatches.filter(x => x.account_record_id === account_record_id && x.organization_id === organization_id && x.team_workspace_id === team_workspace_id && x.account_id === account_id && x.user_id === user_id) }
    }
    if (text.startsWith('update atlas_paper_risk_latches')) {
      const [account_record_id, latch_state, reason, changed_by_user_id, changed_by_role, revision, expectedRevision] = params
      const row = state.riskLatches.find(x => x.account_record_id === account_record_id && x.revision === expectedRevision)
      if (!row) return { rows: [] }
      Object.assign(row, { latch_state, reason, changed_by_user_id, changed_by_role, revision, updated_at: now })
      return { rows: [row] }
    }
    if (text.startsWith('insert into atlas_paper_risk_latch_audit')) {
      const [id, account_record_id, organization_id, team_workspace_id, account_id, user_id, action, previous_state, next_state, reason, actor_user_id, actor_role, latch_revision, evidence] = params
      const row = { id, account_record_id, organization_id, team_workspace_id, account_id, user_id, action, previous_state, next_state, reason, actor_user_id, actor_role, latch_revision, evidence, created_at: now }
      state.riskLatchAudit.push(row)
      return { rows: [row] }
    }
    if (text.startsWith('select * from atlas_paper_accounts')) {
      const [organization_id, team_workspace_id, account_id, user_id] = params
      return { rows: state.accounts.filter(x => x.organization_id === organization_id && x.team_workspace_id === team_workspace_id && x.account_id === account_id && x.user_id === user_id) }
    }
    if (text.includes('from atlas_ai_opportunity_analysis_history')) {
      return { rows: this.evidenceAvailable ? [{ id: text.includes("analysis_category='paper_evaluation'") ? 'evaluation-row-1' : 'intent-row-1' }] : [] }
    }
    if (text.startsWith('select * from atlas_paper_positions') && text.includes('where id=$1')) {
      const [id, account_record_id, organization_id, team_workspace_id, account_id, user_id] = params
      return { rows: state.positions.filter(x => x.id === id && x.account_record_id === account_record_id && x.organization_id === organization_id && x.team_workspace_id === team_workspace_id && x.account_id === account_id && x.user_id === user_id) }
    }
    if (text.startsWith('select * from atlas_paper_positions')) {
      const rows = state.positions.filter(x => x.account_record_id === params[0] && (!text.includes("status='open'") || (x.status === 'open' && x.quantity > 0)))
      return { rows }
    }
    if (text.startsWith('select * from atlas_paper_executions') && text.includes("payload->'forwardobservation'")) {
      const [organization_id, team_workspace_id, account_id, user_id] = params
      return { rows: state.executions.filter(x => x.organization_id === organization_id && x.team_workspace_id === team_workspace_id && x.account_id === account_id && x.user_id === user_id && x.execution_type === 'close' && x.payload?.forwardObservation?.experimentId) }
    }
    if (text.startsWith('select * from atlas_paper_executions') && text.includes('organization_id=$1')) {
      const [organization_id, team_workspace_id, account_id, user_id, limit] = params
      const rows = state.executions.filter(x => x.organization_id === organization_id && x.team_workspace_id === team_workspace_id && x.account_id === account_id && x.user_id === user_id)
      return { rows: limit == null ? rows : rows.slice(-limit) }
    }
    if (text.startsWith('select payload from atlas_paper_executions') && text.includes("execution_type='entry'")) {
      const [account_record_id, position_id] = params
      return { rows: state.executions.filter(x => x.account_record_id === account_record_id && x.position_id === position_id && x.execution_type === 'entry').map(x => ({ payload: x.payload })) }
    }
    if (text.startsWith('select * from atlas_paper_executions') && text.includes('position_id=$2') && text.includes('order by created_at')) {
      const [account_record_id, position_id] = params
      return { rows: state.executions.filter(x => x.account_record_id === account_record_id && x.position_id === position_id) }
    }
    if (text.startsWith('select * from atlas_paper_executions')) {
      const [account_record_id, idempotency_fingerprint] = params
      return { rows: state.executions.filter(x => x.account_record_id === account_record_id && x.idempotency_fingerprint === idempotency_fingerprint) }
    }
    if (text.startsWith('insert into atlas_paper_executions')) {
      const isEntry = text.includes("$7,'entry',$8")
      const row = isEntry
        ? { id: params[0], account_record_id: params[1], organization_id: params[2], team_workspace_id: params[3], account_id: params[4], user_id: params[5], position_id: params[6], execution_type: 'entry', idempotency_fingerprint: params[7], candidate_id: params[8], evaluation_id: params[9], execution_intent_id: params[10], strategy_id: params[11], symbol: params[12], asset_type: params[13], side: params[14], quantity: params[15], fill_price: params[16], fees: params[17], slippage_bps: params[18], cash_impact: params[19], realized_pnl_delta: 0, evidence_timestamp: params[20], engine_version: params[21], payload: params[22], created_at: now }
        : { id: params[0], account_record_id: params[1], organization_id: params[2], team_workspace_id: params[3], account_id: params[4], user_id: params[5], position_id: params[6], execution_type: params[7], idempotency_fingerprint: params[8], candidate_id: params[9], evaluation_id: params[10], execution_intent_id: params[11], strategy_id: params[12], symbol: params[13], asset_type: params[14], side: params[15], quantity: params[16], fill_price: params[17], fees: params[18], slippage_bps: params[19], cash_impact: params[20], realized_pnl_delta: params[21], evidence_timestamp: params[22], engine_version: params[23], payload: params[24], created_at: now }
      if (state.executions.some(x => x.account_record_id === row.account_record_id && x.idempotency_fingerprint === row.idempotency_fingerprint)) return { rows: [] }
      state.executions.push(row)
      return { rows: [row] }
    }
    if (text.startsWith('update atlas_paper_accounts')) {
      const [id, cash, buying_power, equity, realized_pnl, revision] = params
      const row = state.accounts.find(x => x.id === id && x.revision === revision)
      if (!row) return { rows: [] }
      Object.assign(row, { cash, buying_power, equity, realized_pnl, revision: row.revision + 1, updated_at: now })
      return { rows: [row] }
    }
    if (text.startsWith('insert into atlas_paper_positions')) {
      const [id, account_record_id, organization_id, team_workspace_id, account_id, user_id, symbol, asset_type, side, quantity, average_cost, current_price, mark_evidence_timestamp, risk_state, realized_pnl, originating_candidate_id, originating_evaluation_id, originating_intent_fingerprint, strategy_id] = params
      let row = state.positions.find(x => x.account_record_id === account_record_id && x.symbol === symbol && x.asset_type === asset_type && x.side === side)
      if (row) {
        const reopening = row.status === 'closed'
        Object.assign(row, { quantity, average_cost, current_price, mark_evidence_timestamp, risk_state, strategy_id, status: 'open', revision: row.revision + 1, updated_at: now })
        if (reopening) Object.assign(row, { originating_candidate_id, originating_evaluation_id, originating_intent_fingerprint })
      }
      else { row = { id, account_record_id, organization_id, team_workspace_id, account_id, user_id, symbol, asset_type, side, quantity, average_cost, current_price, mark_evidence_timestamp, risk_state, realized_pnl, originating_candidate_id, originating_evaluation_id, originating_intent_fingerprint, strategy_id, status: 'open', revision: 0, created_at: now, updated_at: now }; state.positions.push(row) }
      return { rows: [row] }
    }
    if (text.startsWith('update atlas_paper_positions set current_price=$2')) {
      const [id, current_price, mark_evidence_timestamp, revision] = params
      const row = state.positions.find(x => x.id === id && x.revision === revision)
      if (!row) return { rows: [] }
      Object.assign(row, { current_price, mark_evidence_timestamp, revision: row.revision + 1, updated_at: now })
      return { rows: [row] }
    }
    if (text.startsWith('update atlas_paper_positions')) {
      const [id, quantity, average_cost, current_price, mark_evidence_timestamp, risk_state, realized_delta, status, revision] = params
      const row = state.positions.find(x => x.id === id && x.revision === revision)
      if (!row) return { rows: [] }
      Object.assign(row, { quantity, average_cost, current_price, mark_evidence_timestamp, risk_state, realized_pnl: row.realized_pnl + realized_delta, status, revision: row.revision + 1, updated_at: now })
      return { rows: [row] }
    }
    throw new Error(`Unhandled test SQL: ${text}`)
  }
}

async function seeded(options = {}) {
  const database = new PaperPgHarness()
  const repository = createCanonicalPaperLedgerRepository({ database })
  const committed = await repository.commitEntry({ ...scope(), simulation: entry(options.entry) })
  return { database, repository, committed }
}

function entryFor({ symbol, fingerprint, evaluationId, side = 'buy', quantity = 10, price = 100, stopPrice = side === 'short' ? 102 : 98, fees = 1 } = {}) {
  const notional = quantity * price
  const cashImpact = side === 'short' ? notional - fees : -(notional + fees)
  return entry({
    fingerprint,
    evaluationId,
    evaluationEvidenceFingerprint: `${evaluationId}-evidence`,
    candidateId: `${evaluationId}-candidate`,
    symbol,
    orderPlan: { evidenceTimestamp: now, side, entryType: 'market', referencePrice: price, stopReference: stopPrice, maximumRisk: Math.abs(price - stopPrice) * quantity },
    executionFill: { symbol, assetType: 'equity', side, quantity, fillPrice: price, fees, slippageBps: 2, cashImpact },
  })
}

describe('PI.3 durable paper account and immutable ledger', () => {
  it('initializes the approved account balance once and survives repository re-instantiation', async () => {
    const database = new PaperPgHarness()
    const first = createCanonicalPaperLedgerRepository({ database })
    expect((await first.getOrCreateAccount(scope())).account.cash).toBe(DEFAULT_INITIAL_PAPER_BALANCE)
    expect((await createCanonicalPaperLedgerRepository({ database }).getOrCreateAccount(scope())).account.cash).toBe(DEFAULT_INITIAL_PAPER_BALANCE)
    expect(database.state.accounts).toHaveLength(1)
  })

  it('treats both deterministic primary-key and scope uniqueness races as idempotent', () => {
    const source = readFileSync('lib/opportunities/persistence/canonicalPaperLedgerRepository.js', 'utf8')
    const initialization = source.slice(source.indexOf('INSERT INTO atlas_paper_accounts'), source.indexOf('SELECT * FROM atlas_paper_accounts'))
    expect(initialization).toContain('ON CONFLICT DO NOTHING')
    expect(initialization).not.toContain('ON CONFLICT (organization_id')
  })

  it('keeps organizations, accounts, users, and teams isolated', async () => {
    const database = new PaperPgHarness(), repository = createCanonicalPaperLedgerRepository({ database })
    const variants = [scope(), scope({ accountId: 'other-account' }), scope({ tenantContext: { organizationId: 'org-b', teamWorkspaceId: 'team-a', userId: 'user-a' } }), scope({ tenantContext: { organizationId: 'org-a', teamWorkspaceId: 'team-b', userId: 'user-a' } }), scope({ userId: 'user-b', tenantContext: { organizationId: 'org-a', teamWorkspaceId: 'team-a', userId: 'user-b' } })]
    for (const value of variants) await repository.getOrCreateAccount(value)
    expect(database.state.accounts).toHaveLength(5)
    expect(await repository.listExecutions(variants[1])).toEqual([])
  })

  it('commits entry ledger, account, and position atomically with compact linkage', async () => {
    const { database, committed } = await seeded()
    expect(committed).toMatchObject({ duplicate: false, account: { cash: 98999, revision: 1 }, position: { quantity: 10, averagePrice: 100 } })
    expect(database.state.executions).toHaveLength(1)
    expect(committed.execution.payload).toMatchObject({ evaluationId: 'eval-1', executionIntentFingerprint: 'entry-fp-1', executionCalibrationStatus: 'PAPER_ONLY_NOT_LIVE_CALIBRATED', executionRealism: { paperSimulationAdmissibility: { status: 'ADMISSIBLE' }, liveExecutionCalibration: { status: 'NOT_CALIBRATED', liveMoneyReady: false }, chronology: { decisionAt: now, confirmedAt: now, submittedAt: now }, fillEvidence: { costApplications: { spread: 1, slippage: 1, fees: 1 } } }, entryChronology: { version: 'paper-entry-ledger-clock-v1', timeBasis: 'execution_created_at' }, paperTradingOnly: true, liveOrders: false, brokerExecution: false })
    expect(JSON.stringify(committed.execution.payload)).not.toMatch(/rawCandles|apiKey|providerPayload|credential/i)
  })

  it('rolls back an entry without partial ledger, account, or position state', async () => {
    const database = new PaperPgHarness(), repository = createCanonicalPaperLedgerRepository({ database })
    database.failPattern = 'update atlas_paper_accounts'
    await expect(repository.commitEntry({ ...scope(), simulation: entry() })).rejects.toThrow('injected database failure')
    expect(database.state).toEqual({ accounts: [], positions: [], executions: [], riskLatches: [], riskLatchAudit: [] })
  })

  it('suppresses retry after restart and concurrent duplicate entry without double debit', async () => {
    const database = new PaperPgHarness(), one = createCanonicalPaperLedgerRepository({ database }), two = createCanonicalPaperLedgerRepository({ database })
    const [a, b] = await Promise.all([one.commitEntry({ ...scope(), simulation: entry() }), two.commitEntry({ ...scope(), simulation: entry() })])
    expect([a.duplicate, b.duplicate].sort()).toEqual([false, true])
    expect(database.state.executions).toHaveLength(1)
    expect(database.state.accounts[0].cash).toBe(98999)
  })

  it('uses durable cash and computes weighted average cost across entries', async () => {
    const { database, repository } = await seeded()
    const second = entry({ fingerprint: 'entry-fp-2', evaluationId: 'eval-2', evaluationEvidenceFingerprint: 'eval-evidence-2', executionFill: { ...entry().executionFill, quantity: 10, fillPrice: 120, cashImpact: -1201 } })
    const result = await repository.commitEntry({ ...scope(), simulation: second })
    expect(result.account.cash).toBe(97798)
    expect(result.position).toMatchObject({ quantity: 20, averagePrice: 110 })
    expect((await createCanonicalPaperLedgerRepository({ database }).listOpenPositions(scope()))[0].quantity).toBe(20)
  })

  it('fails closed when durable evidence is missing or PostgreSQL is unavailable', async () => {
    const database = new PaperPgHarness(), repository = createCanonicalPaperLedgerRepository({ database })
    database.evidenceAvailable = false
    await expect(repository.commitEntry({ ...scope(), simulation: entry() })).rejects.toMatchObject({ code: 'paper_ledger_evidence_missing' })
    expect(() => resolveCanonicalPaperLedgerRepository({ persistenceRepository: { connected: false } })).toThrow('Canonical PostgreSQL')
  })
})

describe('canonical paper valuation and risk-state contract', () => {
  it('reconciles one marked long position as cash plus signed marked value', async () => {
    const { repository } = await seeded()
    const state = await repository.getCanonicalState({ ...scope(), marks: [{ symbol: 'AAPL', price: 105, updatedAt: now }], now, requireKnownRisk: true })
    expect(state.valuation).toMatchObject({ status: 'RECONCILED', cash: 98999, signedMarkedValue: 1050, equity: 100049 })
    expect(state.riskState.status).toBe('KNOWN')
    expect(state.risk.summary.openRisk).toBe(20)
  })

  it('preserves another long position and reconciles equity after a full close', async () => {
    const { repository, committed } = await seeded()
    await repository.commitEntry({ ...scope(), simulation: entryFor({ symbol: 'MSFT', fingerprint: 'entry-msft', evaluationId: 'eval-msft', quantity: 5, price: 200, stopPrice: 196 }) })
    const closed = await repository.commitExit({
      ...scope(), positionId: committed.position.positionId, quantity: 10,
      quote: { price: 110, updatedAt: now, liquidityScore: 80 },
      marks: [{ symbol: 'MSFT', price: 205, updatedAt: now }],
      paperModeEnabled: true, confirmed: true, now,
    })
    const remaining = await repository.listOpenPositions(scope())
    expect(remaining).toHaveLength(1)
    expect(remaining[0]).toMatchObject({ symbol: 'MSFT', quantity: 5, currentPrice: 205 })
    expect(closed.account.equity).toBeCloseTo(closed.account.cash + (5 * 205), 2)
  })

  it('reconciles mixed long/short exposure and scales risk on a partial close', async () => {
    const { repository, committed } = await seeded()
    await repository.commitEntry({ ...scope(), simulation: entryFor({ symbol: 'MSFT', fingerprint: 'entry-short', evaluationId: 'eval-short', side: 'short', quantity: 5, price: 120, stopPrice: 122 }) })
    const before = await repository.getCanonicalState({ ...scope(), marks: [{ symbol: 'AAPL', price: 100, updatedAt: now }, { symbol: 'MSFT', price: 100, updatedAt: now }], now, requireKnownRisk: true })
    expect(before.account.equity).toBeCloseTo(before.account.cash + 1000 - 500, 2)
    const reduced = await repository.commitExit({
      ...scope(), positionId: committed.position.positionId, quantity: 4,
      quote: { price: 110, updatedAt: now, liquidityScore: 80 },
      marks: [{ symbol: 'MSFT', price: 100, updatedAt: now }],
      paperModeEnabled: true, confirmed: true, now,
    })
    expect(reduced.position).toMatchObject({ quantity: 6, riskState: { status: 'KNOWN', openRisk: 12 } })
    expect(reduced.account.equity).toBeCloseTo(reduced.account.cash + (6 * reduced.position.currentPrice) - 500, 2)
  })

  it('fails closed for missing or stale marks and explicit unknown open risk', async () => {
    const { database, repository } = await seeded()
    const later = '2026-08-13T12:10:00.000Z'
    await expect(repository.getCanonicalState({ ...scope(), now: later, requireKnownRisk: true })).rejects.toMatchObject({ code: 'paper_ledger_marks_unavailable' })
    database.state.positions[0].risk_state = null
    const unknown = await repository.getCanonicalState({ ...scope(), marks: [{ symbol: 'AAPL', price: 101, updatedAt: later }], now: later })
    expect(unknown).toMatchObject({ riskState: { status: 'UNKNOWN' }, risk: { state: 'UNKNOWN', summary: { openRisk: null, openRiskPct: null } } })
    await expect(repository.getCanonicalState({ ...scope(), marks: [{ symbol: 'AAPL', price: 101, updatedAt: later }], now: later, requireKnownRisk: true })).rejects.toMatchObject({ code: 'paper_ledger_risk_state_unknown' })
  })

  it('serializes concurrent admissions so portfolio heat cannot cross the existing limit', async () => {
    const database = new PaperPgHarness()
    const symbols = ['AAPL', 'MSFT', 'GOOG', 'AMZN', 'META', 'NVDA', 'TSLA']
    const marks = symbols.map(symbol => ({ symbol, price: 100, updatedAt: now }))
    const attempts = symbols.map((symbol, index) => createCanonicalPaperLedgerRepository({ database }).commitEntry({
      ...scope(), marks, now,
      simulation: entryFor({ symbol, fingerprint: `heat-${index}`, evaluationId: `heat-eval-${index}`, quantity: 100, price: 100, stopPrice: 91, fees: 0 }),
    }))
    const settled = await Promise.allSettled(attempts)
    expect(settled.filter(item => item.status === 'fulfilled')).toHaveLength(6)
    expect(settled.filter(item => item.status === 'rejected')).toHaveLength(1)
    expect(settled.find(item => item.status === 'rejected').reason).toMatchObject({ code: 'paper_ledger_conflict' })
    expect(database.state.positions).toHaveLength(6)
    expect(database.state.executions).toHaveLength(6)
  })
})

describe('PI.3 transactional reductions, closes, and realized performance evidence', () => {
  it('persists the server manifest atomically with a compliant human-confirmed close', async () => {
    // Deliberately labeled GENUINE only inside this isolated SQL harness; no live DB or collector.
    const fixture = exitEvidenceFixture({ entryAt: now, evidenceClass: 'GENUINE', mutate: (_data, minutes) => { minutes[2].low = 97 } })
    const { database, committed } = await seeded({ entry: { strategyId: 'index-pullback-v1', exitPolicy: fixture.context.policy } })
    const repository = createCanonicalPaperLedgerRepository({ database, exitEvidenceSource: fixture.source, exitEvidenceQualification: fixture.qualification, exitEvidenceClock: fixture.clock })
    const input = { ...scope(), positionId: committed.position.positionId, quantity: 10, confirmed: true, paperModeEnabled: true, quote: { price: 110, updatedAt: fixture.now }, now: fixture.now,
      // None of these may override the source or the locked entry.
      policyBar: { low: 1 }, sessionsHeld: 999, exitEvidence: { status: 'AVAILABLE' }, exitPolicy: { fingerprint: 'forged' } }
    const closed = await repository.commitExit(input)
    expect(closed).toMatchObject({ ok: true, result: { status: 'POSITION_CLOSED', exitPlan: { referencePrice: 98, simulatedExitPrice: 97.95 }, exitAttribution: { policyCompliant: true } } })
    const manifest = closed.execution.payload.exitEvidenceManifest
    expect(manifest.binding).toMatchObject({ organizationId: 'org-a', userId: 'user-a', accountId: 'paper-portfolio', positionRevision: committed.position.revision,
      entryExecutionId: committed.execution.executionId, entryExecutionAt: now, evaluationFingerprint: 'eval-evidence-1', intentFingerprint: 'entry-fp-1' })
    expect(closed.execution.payload.exitAttribution.evidenceManifestHash).toBe(manifest.manifestHash)
    expect(closed.result.exitEvidenceManifest).toEqual(manifest)
    expect((await repository.commitExit(input)).duplicate).toBe(true)
    expect(database.state.executions).toHaveLength(2)
    const durable = await createCanonicalPaperLedgerRepository({ database }).listExecutions(scope())
    expect(durable.find((row) => row.executionType === 'close').payload.exitEvidenceManifest).toEqual(manifest)
    expect(buildCanonicalPaperOutcomes(durable).outcomes[0].exitEvidenceManifest).toEqual(manifest)
  })

  it.each(['SYNTHETIC', 'unknown-finality', 'legacy-entry', 'partial-close'])('never persists a compliant outcome for %s', async (mode) => {
    const fixture = exitEvidenceFixture({ entryAt: now, evidenceClass: mode === 'SYNTHETIC' ? 'SYNTHETIC' : 'GENUINE', mutate: (data, minutes) => {
      minutes[2].low = 97
      if (mode === 'unknown-finality') data.quality.finality = 'UNKNOWN'
    } })
    const { database, committed } = await seeded({ entry: { strategyId: 'index-pullback-v1', exitPolicy: fixture.context.policy, forwardObservation: { experimentId: 'EDGE.2' } } })
    if (mode === 'legacy-entry') delete database.state.executions[0].payload.entryChronology
    const repository = createCanonicalPaperLedgerRepository({ database, exitEvidenceSource: fixture.source, exitEvidenceQualification: fixture.qualification, exitEvidenceClock: fixture.clock })
    const before = structuredClone(database.state)
    const result = await repository.commitExit({ ...scope(), positionId: committed.position.positionId, quantity: mode === 'partial-close' ? 4 : 10,
      confirmed: true, paperModeEnabled: true, quote: { price: 110, updatedAt: fixture.now }, now: fixture.now })
    expect(result.ok).toBe(false)
    expect(result.result.exitAttribution.policyCompliant).toBe(false)
    expect(database.state).toEqual(before)
  })

  it('bypasses unavailable chronology only for a confirmed non-compliant emergency close', async () => {
    const fixture = exitEvidenceFixture({ entryAt: now })
    fixture.source.retrieve = async () => { throw new Error('must not retrieve') }
    const { database, committed } = await seeded({ entry: { strategyId: 'index-pullback-v1', exitPolicy: fixture.context.policy } })
    const repository = createCanonicalPaperLedgerRepository({ database, exitEvidenceSource: fixture.source, exitEvidenceQualification: fixture.qualification })
    const closed = await repository.commitExit({ ...scope(), positionId: committed.position.positionId, quantity: 10, quote: { price: 110, updatedAt: now },
      exitReason: 'manual_emergency', confirmed: true, paperModeEnabled: true, now })
    expect(closed.execution.payload).toMatchObject({ exitEvidenceManifest: null, exitAttribution: { policyCompliant: false, countsTowardObservationMinimum: false } })
  })

  it.each([
    { policyBar: { open: 100, high: 101, low: 97, close: 99, freshness: 'FRESH', observedAt: now } },
    { policyBar: { open: 100, high: 105, low: 99, close: 104, freshness: 'FRESH', observedAt: now } },
    { policyBar: { open: 100, high: 105, low: 97, close: 103, freshness: 'FRESH', observedAt: now } },
    { policyBar: { open: 95, high: 96, low: 94, close: 95, freshness: 'FRESH', observedAt: now } },
    { policyBar: { open: 106, high: 108, low: 105, close: 107, freshness: 'FRESH', observedAt: now } },
    { sessionsHeld: 20 },
    { sessionsHeld: 200, policyBar: { open: 100, high: 101, low: 99, close: 100, freshness: 'FRESH', observedAt: now } },
    { policyBar: { freshness: 'STALE' } },
    { exitPolicy: null },
    { exitPolicy: { version: 'forged' }, policyEvidence: { authoritative: true, complete: true } },
  ])('fails closed without durable mutation when a caller asserts chronology: %j', async (assertions) => {
    const policy = createIndexPullbackExitPolicy({ strategyId: 'index-pullback-v1', strategyVersion: '1.2.0', side: 'long', entryPrice: 100, stopPrice: 98, targetPrice: 104, enteredAt: now })
    const { database, repository, committed } = await seeded({ entry: { strategyId: 'index-pullback-v1', exitPolicy: policy } })
    const before = structuredClone(database.state)
    const blocked = await repository.commitExit({ ...scope(), positionId: committed.position.positionId, quantity: 10, quote: { price: 110, updatedAt: now }, confirmed: true, paperModeEnabled: true, now, ...assertions })
    expect(blocked).toMatchObject({ ok: false, result: { status: 'REJECTED', blockers: ['authoritative_exit_chronology_unavailable'], exitPolicy: policy, exitAttribution: { policyCompliant: false, countsTowardObservationMinimum: false } } })
    expect(database.state).toEqual(before)
  })

  it('fails closed for missing durable policy/entry linkage instead of treating it as discretionary authority', async () => {
    const { database, repository, committed } = await seeded({ entry: { strategyId: 'index-pullback-v1' } })
    database.state.executions = []
    const before = structuredClone(database.state)
    const result = await repository.commitExit({ ...scope(), positionId: committed.position.positionId, quantity: 10, quote: { price: 110, updatedAt: now }, confirmed: true, paperModeEnabled: true, now })
    expect(result.result.blockers).toEqual(['authoritative_exit_chronology_unavailable'])
    expect(database.state).toEqual(before)
  })

  it('requires explicit human confirmation even for emergency closes at the ledger boundary', async () => {
    const { database, repository, committed } = await seeded()
    const before = structuredClone(database.state)
    await expect(repository.commitExit({ ...scope(), positionId: committed.position.positionId, quantity: 10, exitReason: 'manual_emergency', quote: { price: 110, updatedAt: now }, paperModeEnabled: true, now })).rejects.toThrow('Explicit human')
    expect(database.state).toEqual(before)
  })

  it('preserves EDGE.2 identity on an emergency close without making it qualifying', async () => {
    const policy = createIndexPullbackExitPolicy({ strategyId: 'index-pullback-v1', strategyVersion: '1.2.0', side: 'long', entryPrice: 100, stopPrice: 98, targetPrice: 104, enteredAt: now })
    const cohort = { experimentId: 'EDGE.2', observationId: 'edge-a', manifestFingerprint: 'manifest-a' }
    const { database, repository, committed } = await seeded({ entry: { strategyId: 'index-pullback-v1', strategyFingerprint: 'strategy-a', exitPolicy: policy, forwardObservation: cohort } })
    expect(committed.execution.payload.forwardObservation).toEqual(cohort)
    const closed = await repository.commitExit({ ...scope(), positionId: committed.position.positionId, quantity: 10, quote: { price: 98, updatedAt: now, liquidityScore: 80 }, exitPolicy: { ...policy, fingerprint: 'caller-forgery' }, exitReason: 'manual_emergency', paperModeEnabled: true, confirmed: true, now })
    expect(closed.execution.payload).toMatchObject({ executionType: 'close', forwardObservation: cohort, exitAttribution: { policyCompliant: false, countsTowardObservationMinimum: false }, exitPolicy: policy, evaluationEvidenceFingerprint: 'eval-evidence-1' })
    expect(closed.execution.payload.entryEvidence).toMatchObject([{
      executionId: committed.execution.executionId, strategyId: 'index-pullback-v1', evaluationId: 'eval-1',
      evaluationEvidenceFingerprint: 'eval-evidence-1', executionIntentFingerprint: 'entry-fp-1', exitPolicy: policy, forwardObservation: cohort,
    }])
    expect(database.state.executions[0].payload).toEqual(committed.execution.payload)
    expect(closed.execution.fillPrice).toBe(97.95)
    expect(closed.execution.fees).toBe(0.49)
    expect(closed.execution.realizedPnlDelta).toBe(-21.99)
    expect(closed.account.cash).toBe(99978.01)
    expect(closed.account.realizedPnl).toBe(-21.99)
    expect(closed.position).toMatchObject({ quantity: 0, realizedPnl: -21.99, status: 'closed' })
    const durable = await createCanonicalPaperLedgerRepository({ database }).listExecutions(scope())
    expect(durable.find((record) => record.executionType === 'close')?.payload?.forwardObservation).toEqual(cohort)
    expect((await repository.listForwardObservationExecutions(scope())).map((record) => record.executionType)).toEqual(['close'])
  })
  it('partially reduces, preserves cost basis, and records realized profit/cash/P&L', async () => {
    const { repository, committed } = await seeded()
    const result = await repository.commitExit({ ...scope(), positionId: committed.position.positionId, quantity: 4, quote: { price: 110, updatedAt: now, liquidityScore: 80 }, paperModeEnabled: true, confirmed: true, now })
    expect(result.result.status).toBe('POSITION_REDUCED')
    expect(result.position).toMatchObject({ quantity: 6, averagePrice: 100 })
    expect(result.execution.realizedPnlDelta).toBeGreaterThan(0)
    expect(result.account.cash).toBeGreaterThan(98999)
    expect(result.account.realizedPnl).toBeCloseTo(result.execution.realizedPnlDelta, 2)
  })

  it('allocates entry cost across a reduction and final close into one reconciled outcome', async () => {
    const { repository, committed } = await seeded({ entry: { strategyFingerprint: 'strategy-a', policyFingerprint: 'policy-a' } })
    const reduced = await repository.commitExit({ ...scope(), positionId: committed.position.positionId, quantity: 4, quote: { price: 110, updatedAt: now, liquidityScore: 80 }, paperModeEnabled: true, confirmed: true, now })
    const closed = await repository.commitExit({ ...scope(), positionId: committed.position.positionId, quantity: 6, quote: { price: 110, updatedAt: '2026-08-13T12:00:01.000Z', liquidityScore: 80 }, paperModeEnabled: true, confirmed: true, now: '2026-08-13T12:00:01.000Z' })
    expect(reduced.execution.payload.entryFeeAllocation).toBe(0.4)
    expect(closed.execution.payload.entryFeeAllocation).toBe(0.6)
    const executions = await repository.listExecutions(scope())
    const measurement = buildCanonicalPaperOutcomes(executions)
    expect(measurement.outcomes).toHaveLength(1)
    expect(measurement.outcomes[0]).toMatchObject({ reductionExecutionIds: [reduced.execution.executionId], pnlReconciliation: { status: 'RECONCILED' }, quantityReconciliation: { status: 'RECONCILED' } })
    expect(closed.account.realizedPnl).toBeCloseTo(measurement.outcomes[0].netPnl, 2)
  })

  it('fully closes without reversal and survives repository re-instantiation', async () => {
    const { database, repository, committed } = await seeded()
    const result = await repository.commitExit({ ...scope(), positionId: committed.position.positionId, quantity: 10, quote: { price: 90, updatedAt: now, liquidityScore: 80 }, paperModeEnabled: true, confirmed: true, now })
    expect(result.result.status).toBe('POSITION_CLOSED')
    expect(result.position).toMatchObject({ quantity: 0, status: 'closed' })
    expect(result.execution.realizedPnlDelta).toBeLessThan(0)
    expect(await createCanonicalPaperLedgerRepository({ database }).listOpenPositions(scope())).toEqual([])
  })

  it('rolls back exits without partial execution or realized P&L', async () => {
    const { database, repository, committed } = await seeded()
    const before = structuredClone(database.state)
    database.failPattern = 'update atlas_paper_accounts'
    await expect(repository.commitExit({ ...scope(), positionId: committed.position.positionId, quantity: 4, quote: { price: 110, updatedAt: now, liquidityScore: 80 }, paperModeEnabled: true, confirmed: true, now })).rejects.toThrow('injected database failure')
    expect(database.state).toEqual(before)
  })

  it('suppresses duplicate exit after restart and concurrent over-close', async () => {
    const { database, committed } = await seeded()
    const one = createCanonicalPaperLedgerRepository({ database }), two = createCanonicalPaperLedgerRepository({ database })
    const request = { ...scope(), positionId: committed.position.positionId, quantity: 10, quote: { price: 110, updatedAt: now, liquidityScore: 80 }, paperModeEnabled: true, confirmed: true, now }
    const [a, b] = await Promise.all([one.commitExit(request), two.commitExit(request)])
    expect([a.duplicate, b.duplicate].sort()).toEqual([false, true])
    expect(database.state.executions.filter(x => x.execution_type === 'close')).toHaveLength(1)
    expect(database.state.positions[0].quantity).toBe(0)
  })

  it('rejects an over-close before mutation', async () => {
    const { database, repository, committed } = await seeded()
    const result = await repository.commitExit({ ...scope(), positionId: committed.position.positionId, quantity: 11, quote: { price: 110, updatedAt: now, liquidityScore: 80 }, paperModeEnabled: true, confirmed: true, now })
    expect(result.result.status).toBe('REJECTED')
    expect(database.state.executions).toHaveLength(1)
    expect(database.state.positions[0].quantity).toBe(10)
  })

  it('preserves short accounting semantics', async () => {
    const { repository, committed } = await seeded({ entry: { symbol: 'MSFT', fingerprint: 'short-entry', executionFill: { symbol: 'MSFT', assetType: 'equity', side: 'short', quantity: 5, fillPrice: 120, fees: 1, slippageBps: 2, cashImpact: 599 } } })
    const exit = await repository.commitExit({ ...scope(), positionId: committed.position.positionId, quantity: 5, quote: { price: 100, updatedAt: now, liquidityScore: 80 }, paperModeEnabled: true, confirmed: true, now })
    expect(exit.result.status).toBe('POSITION_CLOSED')
    expect(exit.execution.realizedPnlDelta).toBeGreaterThan(0)
  })

  it('returns tenant-scoped immutable realized executions for deterministic PA.3/PA.5 input', async () => {
    const { repository, committed } = await seeded()
    await repository.commitExit({ ...scope(), positionId: committed.position.positionId, quantity: 5, quote: { price: 110, updatedAt: now, liquidityScore: 80 }, paperModeEnabled: true, confirmed: true, now })
    const executions = await repository.listExecutions(scope())
    expect(executions.map(x => x.executionType)).toEqual(['entry', 'reduction'])
    expect(executions[1]).toMatchObject({ paperTradingOnly: true, realizedPnlDelta: expect.any(Number) })
  })
})

describe('PI.3 migration and integration boundaries', () => {
  const migration = readFileSync('lib/db/migrations.js', 'utf8')
  const pa2 = readFileSync('netlify/functions/paper-order-simulation.js', 'utf8')
  const pa4 = readFileSync('netlify/functions/paper-position-exit.js', 'utf8')
  const pa3 = readFileSync('netlify/functions/paper-performance-review.js', 'utf8')
  const pa5 = readFileSync('netlify/functions/paper-learning.js', 'utf8')

  it('adds one ordered additive migration with tracking-safe constraints and indexes', () => {
    expect(migration).toContain('202608130069_pi3_transactional_paper_account_ledger')
    const start = migration.indexOf('202608130069_pi3_transactional_paper_account_ledger')
    const next = migration.indexOf('Object.freeze({', start + 1)
    const section = migration.slice(start, next === -1 ? undefined : next)
    expect(section).toMatch(/UNIQUE \(account_record_id, idempotency_fingerprint\)/)
    expect(section).toMatch(/revision BIGINT NOT NULL DEFAULT 0/)
    expect(section).toMatch(/CREATE INDEX IF NOT EXISTS/)
    expect(section).not.toMatch(/\b(DROP|TRUNCATE)\b/)
  })

  it('routes PA.2 and PA.4 through the canonical ledger while retaining the legacy module', () => {
    expect(pa2).toContain('ledger.commitEntry')
    expect(pa4).toContain('ledger.commitExit')
    expect(pa2).toContain('ledger.getCanonicalState')
    expect(pa2).not.toContain('getPortfolioSummary')
    expect(pa2 + pa4).not.toContain('paperPositionStore')
    expect(readFileSync('lib/opportunities/paperExit/paperPositionStore.js', 'utf8')).toContain('paper-position-lifecycle-v1')
  })

  it('adds mark-evidence and explicit risk-state columns without rewriting the PI.3 migration', () => {
    expect(migration).toContain('202609230001_canonical_paper_position_valuation_risk_state')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS mark_evidence_timestamp TIMESTAMPTZ')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS risk_state JSONB')
  })

  it('routes PA.3 and PA.5 to immutable realized executions without changing formulas', () => {
    expect(pa3 + pa5).toContain('ledger.listExecutions')
    expect(pa3 + pa5).not.toContain('listPaperPositionAggregates')
    expect(readFileSync('lib/analytics/paperPerformanceReviewEngine.js', 'utf8')).toContain("PAPER_PERFORMANCE_REVIEW_VERSION='paper-performance-review-v1'")
  })

  it('contains no live broker, provider, authentication, strategy, scoring, regime, or risk implementation', () => {
    const source = readFileSync('lib/opportunities/persistence/canonicalPaperLedgerRepository.js', 'utf8')
    expect(source).not.toMatch(/placeLiveOrder|brokerClient|providerCredential|authenticateUser|scoreOpportunity|detectMarketRegime/)
    expect(source).toContain('brokerExecution: false')
  })
})

const configuredDatabaseUrl = process.env.DATABASE_URL
const localPostgresAvailable = process.env.ATLAS_POSTGRES_INTEGRATION === 'true' && (() => {
  try {
    return ['localhost', '127.0.0.1', '::1'].includes(new URL(configuredDatabaseUrl).hostname)
  } catch {
    return false
  }
})()

describe.runIf(localPostgresAvailable)('Phase 2 durable PAPER risk latch PostgreSQL contract', () => {
  const schema = `atlas_phase2_latch_${process.pid}_${Date.now()}`
  const pools = new Set()
  let adminPool
  let base

  function databaseFor(applicationName) {
    const pool = new pg.Pool({
      connectionString: configuredDatabaseUrl,
      max: 4,
      application_name: applicationName,
      options: `-c search_path=${schema},public`,
    })
    pools.add(pool)
    return {
      pool,
      database: createDatabaseAdapter({
        client: {
          connected: true,
          query: (sql, params) => pool.query(sql, params),
          connect: () => pool.connect(),
          end: () => pool.end(),
        },
      }),
    }
  }

  async function seedEvidence(database, value, targetScope) {
    const common = [
      targetScope.tenantContext.organizationId,
      targetScope.tenantContext.teamWorkspaceId ?? '',
      targetScope.accountId,
      targetScope.userId,
    ]
    for (const [category, fingerprint, id] of [
      ['paper_evaluation', value.evaluationEvidenceFingerprint, `evaluation-${value.evaluationId}`],
      ['paper_simulation', value.fingerprint, `intent-${value.fingerprint}`],
    ]) {
      await database.query(
        `INSERT INTO atlas_ai_opportunity_analysis_history
          (id,organization_id,team_workspace_id,account_id,user_id,session_id,analysis_category,market_data_as_of,
           candidate_fingerprints,deterministic_baseline_ranks,advisory_ranking,excluded_candidates,no_trade_recommended,
           provider,model,prompt_version,context_fingerprint,latency_ms,usage_estimate,status,payload,created_at)
         VALUES ($1,$2,$3,$4,$5,'phase2-test-session',$6,$7,$8,$9,$10,$11,false,
           'phase2-test','deterministic','phase2-v1',$12,0,$13,'complete',$14,NOW())
         ON CONFLICT (id) DO NOTHING`,
        [id, ...common, category, value.simulatedAt, [], [], [], [], fingerprint, {}, {
          paperTradingOnly: true,
          ...(category === 'paper_evaluation' ? { paperEvaluation: { evaluationId: value.evaluationId } } : {}),
        }],
      )
    }
  }

  async function waitForDatabaseLock(applicationName) {
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      const result = await adminPool.query(
        `SELECT wait_event_type FROM pg_stat_activity
         WHERE datname=current_database() AND application_name=$1`,
        [applicationName],
      )
      if (result.rows.some((row) => row.wait_event_type === 'Lock')) return
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error(`PostgreSQL session ${applicationName} did not enter a real lock wait`)
  }

  async function holdAccountLock(targetScope) {
    const holder = databaseFor(`phase2-holder-${Date.now()}`).pool
    const client = await holder.connect()
    await client.query('BEGIN')
    await client.query(
      `SELECT id FROM atlas_paper_accounts
       WHERE organization_id=$1 AND team_workspace_id=$2 AND account_id=$3 AND user_id=$4 FOR UPDATE`,
      [targetScope.tenantContext.organizationId, targetScope.tenantContext.teamWorkspaceId ?? '', targetScope.accountId, targetScope.userId],
    )
    return client
  }

  function latchCommand(targetScope, reason, extra = {}) {
    return {
      ...targetScope,
      reason,
      confirmed: true,
      actor: { userId: targetScope.userId, role: 'owner', source: 'authenticated_human_request' },
      ...extra,
    }
  }

  function endpointFor(ledger, role = 'owner') {
    const user = { id: 'user-a', status: 'active', role, provider: 'test', providerSubject: 'user-a' }
    return createPaperRiskLatchActionHandler({
      ledgerRepository: ledger,
      env: { NODE_ENV: 'test' },
      repositoryFactory: () => ({ end: vi.fn(async () => {}) }),
      authProvider: { authenticate: vi.fn(async () => ({ ok: true, user, session: { id: 'session-a', userId: user.id, status: 'active', expiresAt: '2099-01-01T00:00:00.000Z', metadata: { localDevelopmentOnly: true } } })) },
      authorizationService: { assert: vi.fn(() => ({ allowed: true })) },
      organizationMembershipRepository: { getMembership: vi.fn(async () => ({ organizationId: 'org-a', userId: user.id, role, status: 'active' })) },
      logger: { info: vi.fn(), error: vi.fn() },
    })
  }

  async function invokeLatchEndpoint(ledger, body, role = 'owner') {
    return endpointFor(ledger, role)({
      httpMethod: 'POST',
      headers: { authorization: 'Bearer phase2-test', 'x-csrf-token': 'phase2-csrf', 'content-type': 'application/json' },
      body: JSON.stringify({ organizationId: 'org-a', accountId: 'paper-a', ...body }),
    })
  }

  beforeAll(async () => {
    adminPool = new pg.Pool({ connectionString: configuredDatabaseUrl, max: 2, application_name: 'phase2-latch-admin' })
    await adminPool.query(`CREATE SCHEMA "${schema}"`)
    base = databaseFor('phase2-latch-base')
    await runMigrations(base.database)
  }, 30000)

  afterAll(async () => {
    await Promise.allSettled([...pools].map((pool) => pool.end()))
    if (adminPool) {
      if (/^atlas_phase2_latch_\d+_\d+$/.test(schema)) await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`)
      await adminPool.end()
    }
  }, 30000)

  it('persists and isolates the latch, enforces authenticated reset, and proves real row-lock ordering', async () => {
    const accountA = scope({ accountId: 'paper-a', tenantContext: { organizationId: 'org-a', teamWorkspaceId: '', userId: 'user-a' } })
    const accountB = scope({ accountId: 'paper-b', tenantContext: { organizationId: 'org-a', teamWorkspaceId: '', userId: 'user-a' } })
    const otherTenant = scope({ accountId: 'paper-a', tenantContext: { organizationId: 'org-b', teamWorkspaceId: '', userId: 'user-a' } })
    const missingAccount = scope({ accountId: 'paper-missing', tenantContext: { organizationId: 'org-a', teamWorkspaceId: '', userId: 'user-a' } })
    const baseLedger = createCanonicalPaperLedgerRepository({ database: base.database })
    await Promise.all([baseLedger.getOrCreateAccount(accountA), baseLedger.getOrCreateAccount(accountB), baseLedger.getOrCreateAccount(otherTenant), baseLedger.getOrCreateAccount(missingAccount)])

    const blockedEntry = entryFor({ symbol: 'AAPL', fingerprint: 'phase2-blocked-entry', evaluationId: 'phase2-blocked-eval' })
    await seedEvidence(base.database, blockedEntry, accountA)
    const killFirst = databaseFor('phase2-kill-first')
    const admissionWaiting = databaseFor('phase2-admission-waiting')
    const holderOne = await holdAccountLock(accountA)
    const killPromise = createCanonicalPaperLedgerRepository({ database: killFirst.database }).activateRiskLatch(latchCommand(accountA, 'Operator emergency kill before admission'))
    await waitForDatabaseLock('phase2-kill-first')
    const admissionPromise = createCanonicalPaperLedgerRepository({ database: admissionWaiting.database }).commitEntry({
      ...accountA,
      simulation: blockedEntry,
      riskLatch: 'CLEAR',
      aiOverride: { clearRiskLatch: true },
    })
    await waitForDatabaseLock('phase2-admission-waiting')
    await holderOne.query('COMMIT')
    holderOne.release()
    const killed = await killPromise
    expect(killed.latch).toMatchObject({ state: 'BLOCKED', revision: 1 })
    await expect(admissionPromise).rejects.toMatchObject({ code: 'paper_risk_latch_blocked' })

    const restartEntry = entryFor({ symbol: 'MSFT', fingerprint: 'phase2-restart-entry', evaluationId: 'phase2-restart-eval' })
    await seedEvidence(base.database, restartEntry, accountA)
    await expect(createCanonicalPaperLedgerRepository({ database: base.database }).commitEntry({ ...accountA, simulation: restartEntry })).rejects.toMatchObject({ code: 'paper_risk_latch_blocked' })

    const isolatedEntry = entryFor({ symbol: 'GOOG', fingerprint: 'phase2-isolated-entry', evaluationId: 'phase2-isolated-eval' })
    await seedEvidence(base.database, isolatedEntry, accountB)
    await expect(baseLedger.commitEntry({ ...accountB, simulation: isolatedEntry })).resolves.toMatchObject({ ok: true, duplicate: false })
    const tenantEntry = entryFor({ symbol: 'TSLA', fingerprint: 'phase2-tenant-entry', evaluationId: 'phase2-tenant-eval' })
    await seedEvidence(base.database, tenantEntry, otherTenant)
    await expect(baseLedger.commitEntry({ ...otherTenant, simulation: tenantEntry })).resolves.toMatchObject({ ok: true, duplicate: false })

    const unreadableDatabase = {
      ...base.database,
      transaction: (callback) => base.database.transaction((client) => callback({
        query: (sql, params) => String(sql).includes('SELECT * FROM atlas_paper_risk_latches')
          ? Promise.reject(new Error('injected unreadable latch state'))
          : client.query(sql, params),
      })),
    }
    await expect(createCanonicalPaperLedgerRepository({ database: unreadableDatabase }).commitEntry({ ...accountA, simulation: restartEntry })).rejects.toMatchObject({ code: 'paper_risk_latch_unavailable' })

    const missingRecord = await base.database.query(
      `SELECT id FROM atlas_paper_accounts WHERE organization_id='org-a' AND account_id='paper-missing' AND user_id='user-a'`,
    )
    await base.database.query('DELETE FROM atlas_paper_risk_latches WHERE account_record_id=$1', [missingRecord.rows[0].id])
    const missingEntry = entryFor({ symbol: 'NVDA', fingerprint: 'phase2-missing-entry', evaluationId: 'phase2-missing-eval' })
    await seedEvidence(base.database, missingEntry, missingAccount)
    await expect(baseLedger.commitEntry({ ...missingAccount, simulation: missingEntry })).rejects.toMatchObject({ code: 'paper_risk_latch_blocked' })

    const viewerAttempt = await invokeLatchEndpoint(baseLedger, {
      action: 'RESET', reason: 'AI supplied reset request must not authorize', expectedRevision: 1, confirmed: true,
      actor: { userId: 'user-a', role: 'owner', source: 'authenticated_human_request' }, aiOverride: true, latchState: 'CLEAR',
    }, 'viewer')
    expect(viewerAttempt.statusCode).toBe(403)
    await expect(baseLedger.resetRiskLatch({ ...latchCommand(accountA, 'Copilot must not reset this account', { expectedRevision: 1 }), actor: { userId: 'user-a', role: 'owner', source: 'ai_copilot' } })).rejects.toMatchObject({ code: 'paper_risk_latch_reset_denied' })
    const staleReset = await invokeLatchEndpoint(baseLedger, { action: 'RESET', reason: 'Human reviewed stale revision', expectedRevision: 0, confirmed: true })
    expect(staleReset.statusCode).toBe(409)
    const humanReset = await invokeLatchEndpoint(baseLedger, { action: 'RESET', reason: 'Human reviewed incident and explicitly rearmed PAPER admission', expectedRevision: 1, confirmed: true })
    expect(humanReset.statusCode).toBe(200)

    const admissionFirstEntry = entryFor({ symbol: 'AMZN', fingerprint: 'phase2-admission-first', evaluationId: 'phase2-admission-first-eval' })
    await seedEvidence(base.database, admissionFirstEntry, accountA)
    const admissionFirst = databaseFor('phase2-admission-first')
    const killLater = databaseFor('phase2-kill-later')
    const holderTwo = await holdAccountLock(accountA)
    const firstAdmissionPromise = createCanonicalPaperLedgerRepository({ database: admissionFirst.database }).commitEntry({ ...accountA, simulation: admissionFirstEntry })
    await waitForDatabaseLock('phase2-admission-first')
    const laterKillPromise = createCanonicalPaperLedgerRepository({ database: killLater.database }).activateRiskLatch(latchCommand(accountA, 'Kill requested after admitted PAPER order'))
    await waitForDatabaseLock('phase2-kill-later')
    await holderTwo.query('COMMIT')
    holderTwo.release()
    await expect(firstAdmissionPromise).resolves.toMatchObject({ ok: true, duplicate: false })
    await expect(laterKillPromise).resolves.toMatchObject({ latch: { state: 'BLOCKED', revision: 3 } })

    const killRace = databaseFor('phase2-kill-race')
    const resetRace = databaseFor('phase2-reset-race')
    const admissionRace = databaseFor('phase2-admission-race')
    const holderThree = await holdAccountLock(accountA)
    const racingKill = createCanonicalPaperLedgerRepository({ database: killRace.database }).activateRiskLatch(latchCommand(accountA, 'Second kill must invalidate queued stale reset'))
    await waitForDatabaseLock('phase2-kill-race')
    const racingReset = createCanonicalPaperLedgerRepository({ database: resetRace.database }).resetRiskLatch(latchCommand(accountA, 'Queued human reset carries observed revision', { expectedRevision: 3 }))
    await waitForDatabaseLock('phase2-reset-race')
    const racingEntry = entryFor({ symbol: 'META', fingerprint: 'phase2-racing-entry', evaluationId: 'phase2-racing-eval' })
    await seedEvidence(base.database, racingEntry, accountA)
    const racingAdmission = createCanonicalPaperLedgerRepository({ database: admissionRace.database }).commitEntry({ ...accountA, simulation: racingEntry })
    await waitForDatabaseLock('phase2-admission-race')
    await holderThree.query('COMMIT')
    holderThree.release()
    await expect(racingKill).resolves.toMatchObject({ latch: { state: 'BLOCKED', revision: 4 } })
    await expect(racingReset).rejects.toMatchObject({ code: 'paper_risk_latch_conflict' })
    await expect(racingAdmission).rejects.toMatchObject({ code: 'paper_risk_latch_blocked' })

    const finalReset = await invokeLatchEndpoint(baseLedger, { action: 'RESET', reason: 'Human reviewed second kill and explicitly rearmed PAPER admission', expectedRevision: 4, confirmed: true })
    expect(finalReset.statusCode).toBe(200)
    const audit = await base.database.query(
      `SELECT action,reason,actor_user_id,actor_role,latch_revision,evidence
       FROM atlas_paper_risk_latch_audit WHERE organization_id='org-a' AND account_id='paper-a' ORDER BY latch_revision`,
    )
    expect(audit.rows.map((row) => row.action)).toEqual(['KILL', 'RESET', 'KILL', 'KILL', 'RESET'])
    expect(audit.rows.at(-1)).toMatchObject({ action: 'RESET', actor_user_id: 'user-a', actor_role: 'owner', latch_revision: '5' })
    expect(audit.rows.at(-1).evidence).toMatchObject({ paperTradingOnly: true, actor: { source: 'authenticated_human_request' } })
    await expect(base.database.query(`UPDATE atlas_paper_risk_latch_audit SET reason='forged' WHERE account_id='paper-a'`)).rejects.toThrow('append-only')
  }, 30000)
})
