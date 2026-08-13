import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  createCanonicalPaperLedgerRepository,
  resolveCanonicalPaperLedgerRepository,
  DEFAULT_INITIAL_PAPER_BALANCE,
} from '../lib/opportunities/persistence/canonicalPaperLedgerRepository.js'

const now = '2026-08-13T12:00:00.000Z'
const scope = (overrides = {}) => ({
  tenantContext: { organizationId: 'org-a', teamWorkspaceId: 'team-a', userId: 'user-a' },
  accountId: 'paper-portfolio',
  userId: 'user-a',
  ...overrides,
})

function entry(overrides = {}) {
  return {
    status: 'SIMULATED_FILLED', fingerprint: 'entry-fp-1', evaluationId: 'eval-1',
    evaluationEvidenceFingerprint: 'eval-evidence-1', candidateId: 'candidate-1',
    symbol: 'AAPL', strategyId: 'momentum', simulatedAt: now,
    orderPlan: { evidenceTimestamp: now }, engineVersion: 'guarded-paper-simulation-v1',
    executionFill: { symbol: 'AAPL', assetType: 'equity', side: 'buy', quantity: 10, fillPrice: 100, fees: 1, slippageBps: 2, cashImpact: -1001 },
    journal: { journalStatus: 'recorded' }, tradeQuality: { score: 85, band: 'STRONG' },
    regime: { trendRegime: 'BULL' }, evaluationStatus: 'APPROVED_FOR_PAPER_REVIEW',
    paperTradingOnly: true, liveOrders: false, brokerExecution: false,
    ...overrides,
  }
}

class PaperPgHarness {
  constructor() {
    this.connected = true
    this.state = { accounts: [], positions: [], executions: [] }
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
      if (!state.accounts.some(x => x.organization_id === organization_id && x.team_workspace_id === team_workspace_id && x.account_id === account_id && x.user_id === user_id)) {
        state.accounts.push({ id, organization_id, team_workspace_id, account_id, user_id, cash: balance, buying_power: balance, equity: balance, realized_pnl: 0, revision: 0, created_at: now, updated_at: now })
      }
      return { rows: [] }
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
    if (text.startsWith('select * from atlas_paper_executions') && text.includes('organization_id=$1')) {
      const [organization_id, team_workspace_id, account_id, user_id, limit] = params
      return { rows: state.executions.filter(x => x.organization_id === organization_id && x.team_workspace_id === team_workspace_id && x.account_id === account_id && x.user_id === user_id).slice(0, limit) }
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
      const [id, account_record_id, organization_id, team_workspace_id, account_id, user_id, symbol, asset_type, side, quantity, average_cost, current_price, realized_pnl, originating_candidate_id, originating_evaluation_id, originating_intent_fingerprint, strategy_id] = params
      let row = state.positions.find(x => x.account_record_id === account_record_id && x.symbol === symbol && x.asset_type === asset_type && x.side === side)
      if (row) Object.assign(row, { quantity, average_cost, current_price, strategy_id, status: 'open', revision: row.revision + 1, updated_at: now })
      else { row = { id, account_record_id, organization_id, team_workspace_id, account_id, user_id, symbol, asset_type, side, quantity, average_cost, current_price, realized_pnl, originating_candidate_id, originating_evaluation_id, originating_intent_fingerprint, strategy_id, status: 'open', revision: 0, created_at: now, updated_at: now }; state.positions.push(row) }
      return { rows: [row] }
    }
    if (text.startsWith('update atlas_paper_positions')) {
      const [id, quantity, average_cost, current_price, realized_delta, status, revision] = params
      const row = state.positions.find(x => x.id === id && x.revision === revision)
      if (!row) return { rows: [] }
      Object.assign(row, { quantity, average_cost, current_price, realized_pnl: row.realized_pnl + realized_delta, status, revision: row.revision + 1, updated_at: now })
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
    expect(committed.execution.payload).toMatchObject({ evaluationId: 'eval-1', executionIntentFingerprint: 'entry-fp-1', paperTradingOnly: true, liveOrders: false, brokerExecution: false })
    expect(JSON.stringify(committed.execution.payload)).not.toMatch(/rawCandles|apiKey|providerPayload|credential/i)
  })

  it('rolls back an entry without partial ledger, account, or position state', async () => {
    const database = new PaperPgHarness(), repository = createCanonicalPaperLedgerRepository({ database })
    database.failPattern = 'update atlas_paper_accounts'
    await expect(repository.commitEntry({ ...scope(), simulation: entry() })).rejects.toThrow('injected database failure')
    expect(database.state).toEqual({ accounts: [], positions: [], executions: [] })
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

describe('PI.3 transactional reductions, closes, and realized performance evidence', () => {
  it('partially reduces, preserves cost basis, and records realized profit/cash/P&L', async () => {
    const { repository, committed } = await seeded()
    const result = await repository.commitExit({ ...scope(), positionId: committed.position.positionId, quantity: 4, quote: { price: 110, updatedAt: now, liquidityScore: 80 }, paperModeEnabled: true, now })
    expect(result.result.status).toBe('POSITION_REDUCED')
    expect(result.position).toMatchObject({ quantity: 6, averagePrice: 100 })
    expect(result.execution.realizedPnlDelta).toBeGreaterThan(0)
    expect(result.account.cash).toBeGreaterThan(98999)
    expect(result.account.realizedPnl).toBeCloseTo(result.execution.realizedPnlDelta, 2)
  })

  it('fully closes without reversal and survives repository re-instantiation', async () => {
    const { database, repository, committed } = await seeded()
    const result = await repository.commitExit({ ...scope(), positionId: committed.position.positionId, quantity: 10, quote: { price: 90, updatedAt: now, liquidityScore: 80 }, paperModeEnabled: true, now })
    expect(result.result.status).toBe('POSITION_CLOSED')
    expect(result.position).toMatchObject({ quantity: 0, status: 'closed' })
    expect(result.execution.realizedPnlDelta).toBeLessThan(0)
    expect(await createCanonicalPaperLedgerRepository({ database }).listOpenPositions(scope())).toEqual([])
  })

  it('rolls back exits without partial execution or realized P&L', async () => {
    const { database, repository, committed } = await seeded()
    const before = structuredClone(database.state)
    database.failPattern = 'update atlas_paper_accounts'
    await expect(repository.commitExit({ ...scope(), positionId: committed.position.positionId, quantity: 4, quote: { price: 110, updatedAt: now, liquidityScore: 80 }, paperModeEnabled: true, now })).rejects.toThrow('injected database failure')
    expect(database.state).toEqual(before)
  })

  it('suppresses duplicate exit after restart and concurrent over-close', async () => {
    const { database, committed } = await seeded()
    const one = createCanonicalPaperLedgerRepository({ database }), two = createCanonicalPaperLedgerRepository({ database })
    const request = { ...scope(), positionId: committed.position.positionId, quantity: 10, quote: { price: 110, updatedAt: now, liquidityScore: 80 }, paperModeEnabled: true, now }
    const [a, b] = await Promise.all([one.commitExit(request), two.commitExit(request)])
    expect([a.duplicate, b.duplicate].sort()).toEqual([false, true])
    expect(database.state.executions.filter(x => x.execution_type === 'close')).toHaveLength(1)
    expect(database.state.positions[0].quantity).toBe(0)
  })

  it('rejects an over-close before mutation', async () => {
    const { database, repository, committed } = await seeded()
    const result = await repository.commitExit({ ...scope(), positionId: committed.position.positionId, quantity: 11, quote: { price: 110, updatedAt: now, liquidityScore: 80 }, paperModeEnabled: true, now })
    expect(result.result.status).toBe('REJECTED')
    expect(database.state.executions).toHaveLength(1)
    expect(database.state.positions[0].quantity).toBe(10)
  })

  it('preserves short accounting semantics', async () => {
    const { repository, committed } = await seeded({ entry: { symbol: 'MSFT', fingerprint: 'short-entry', executionFill: { symbol: 'MSFT', assetType: 'equity', side: 'short', quantity: 5, fillPrice: 120, fees: 1, slippageBps: 2, cashImpact: 599 } } })
    const exit = await repository.commitExit({ ...scope(), positionId: committed.position.positionId, quantity: 5, quote: { price: 100, updatedAt: now, liquidityScore: 80 }, paperModeEnabled: true, now })
    expect(exit.result.status).toBe('POSITION_CLOSED')
    expect(exit.execution.realizedPnlDelta).toBeGreaterThan(0)
  })

  it('returns tenant-scoped immutable realized executions for deterministic PA.3/PA.5 input', async () => {
    const { repository, committed } = await seeded()
    await repository.commitExit({ ...scope(), positionId: committed.position.positionId, quantity: 5, quote: { price: 110, updatedAt: now, liquidityScore: 80 }, paperModeEnabled: true, now })
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
    const section = migration.slice(migration.indexOf('202608130069_pi3_transactional_paper_account_ledger'))
    expect(section).toMatch(/UNIQUE \(account_record_id, idempotency_fingerprint\)/)
    expect(section).toMatch(/revision BIGINT NOT NULL DEFAULT 0/)
    expect(section).toMatch(/CREATE INDEX IF NOT EXISTS/)
    expect(section).not.toMatch(/\b(DROP|TRUNCATE)\b/)
  })

  it('routes PA.2 and PA.4 through the canonical ledger while retaining the legacy module', () => {
    expect(pa2).toContain('ledger.commitEntry')
    expect(pa4).toContain('ledger.commitExit')
    expect(pa2 + pa4).not.toContain('paperPositionStore')
    expect(readFileSync('lib/opportunities/paperExit/paperPositionStore.js', 'utf8')).toContain('paper-position-lifecycle-v1')
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
