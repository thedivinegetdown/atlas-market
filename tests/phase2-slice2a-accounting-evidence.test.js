import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createCanonicalPaperLedgerRepository, DEFAULT_INITIAL_PAPER_BALANCE } from '../lib/opportunities/persistence/canonicalPaperLedgerRepository.js'
import { createAccountingEvidenceRepository } from '../lib/opportunities/persistence/accountingEvidenceRepository.js'

const now = '2026-09-26T12:00:00.000Z'
const scope = (overrides = {}) => ({
  tenantContext: { organizationId: 'org-a', teamWorkspaceId: 'workspace-a', userId: 'user-a' },
  accountId: 'paper-a',
  userId: 'user-a',
  ...overrides,
})
const authority = { source: 'authenticated_human_request', principalType: 'human', userId: 'user-a', role: 'owner' }

function entry() {
  return {
    status: 'SIMULATED_FILLED', fingerprint: 'slice2a-entry-1', evaluationId: 'slice2a-eval-1', evaluationEvidenceFingerprint: 'slice2a-evidence-1',
    candidateId: 'slice2a-candidate-1', symbol: 'AAPL', strategyId: 'momentum', simulatedAt: now,
    orderPlan: { evidenceTimestamp: now, side: 'buy', entryType: 'market', referencePrice: 100, stopReference: 98, maximumRisk: 20 },
    engineVersion: 'guarded-paper-simulation-v3', executionCalibrationStatus: 'PAPER_ONLY_NOT_LIVE_CALIBRATED',
    executionFill: { symbol: 'AAPL', assetType: 'equity', side: 'buy', quantity: 10, referencePrice: 100, fillPrice: 100, fees: 1, slippageBps: 2, cashImpact: -1001 },
    executionRealism: {
      version: 'paper-execution-realism-v2', paperSimulationAdmissibility: { status: 'ADMISSIBLE' },
      liveExecutionCalibration: { status: 'NOT_CALIBRATED', liveMoneyReady: false },
      chronology: { decisionAt: now, confirmedAt: now, submittedAt: now },
      quoteEvidence: { bid: 99.98, ask: 100, observedAt: now },
      quantityEvidence: { requestedQuantity: 10, executableSide: 'ask', displayedSize: 10, fullQuantityDisplayed: true },
      fillEvidence: { status: 'PAPER_FILLED', requestedQuantity: 10, filledQuantity: 10, referencePrice: 100, fillPrice: 100, slippageBps: 2, fees: 1, costApplications: { spread: 1, slippage: 1, fees: 1 } },
    },
  }
}

class Slice2AHarness {
  constructor() {
    this.connected = true
    this.state = { accounts: [], positions: [], executions: [], accountingEvidence: [], riskLatches: [] }
    this.queue = Promise.resolve()
    this.failPattern = null
  }

  async query(sql, params = []) { return this.#run(this.state, sql, params) }

  async transaction(callback) {
    const execute = async () => {
      const draft = structuredClone(this.state)
      const result = await callback({ query: (sql, params = []) => this.#run(draft, sql, params) })
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
      this.failPattern = null
      throw new Error('injected atomicity failure')
    }
    if (text.startsWith('insert into atlas_paper_accounts')) {
      const [id, organization_id, team_workspace_id, account_id, user_id, accounting_origin_id, balance] = params
      if (state.accounts.some((row) => row.organization_id === organization_id && row.team_workspace_id === team_workspace_id && row.account_id === account_id && row.user_id === user_id)) return { rows: [] }
      const row = { id, organization_id, team_workspace_id, account_id, user_id, accounting_origin_id, cash: balance, buying_power: balance, equity: balance, realized_pnl: 0, revision: 0, created_at: now, updated_at: now }
      state.accounts.push(row)
      return { rows: [row] }
    }
    if (text.startsWith('insert into atlas_paper_risk_latches')) {
      const [account_record_id, organization_id, team_workspace_id, account_id, user_id] = params
      state.riskLatches.push({ account_record_id, organization_id, team_workspace_id, account_id, user_id, latch_state: 'CLEAR', reason: 'canonical_account_initialization', changed_by_user_id: 'system', changed_by_role: 'system', revision: 0, created_at: now, updated_at: now })
      return { rows: [] }
    }
    if (text.startsWith('select * from atlas_paper_risk_latches')) {
      const [account_record_id, organization_id, team_workspace_id, account_id, user_id] = params
      return { rows: state.riskLatches.filter((row) => row.account_record_id === account_record_id && row.organization_id === organization_id && row.team_workspace_id === team_workspace_id && row.account_id === account_id && row.user_id === user_id) }
    }
    if (text.startsWith('select * from atlas_paper_accounts')) {
      const [organization_id, team_workspace_id, account_id, user_id] = params
      return { rows: state.accounts.filter((row) => row.organization_id === organization_id && row.team_workspace_id === team_workspace_id && row.account_id === account_id && row.user_id === user_id) }
    }
    if (text.startsWith('update atlas_paper_accounts')) {
      const row = state.accounts.find((account) => account.id === params[0] && account.revision === Number(params.at(-1)))
      if (!row) return { rows: [] }
      if (params.length === 5) Object.assign(row, { cash: params[1], buying_power: params[2], equity: params[3], revision: row.revision + 1, updated_at: now })
      else Object.assign(row, { cash: params[1], buying_power: params[2], equity: params[3], realized_pnl: params[4], revision: row.revision + 1, updated_at: now })
      return { rows: [row] }
    }
    if (text.startsWith('insert into atlas_paper_accounting_evidence')) {
      const [id, account_record_id, organization_id, team_workspace_id, account_id, user_id, accounting_origin_id, event_kind, amount, cash_before, cash_after, account_revision_before, account_revision_after, linked_evidence_id, execution_id, operation_idempotency_key, operation_index, actor_user_id, actor_role, authority_source] = params
      const row = { id, account_record_id, organization_id, team_workspace_id, account_id, user_id, accounting_origin_id, event_kind, amount, cash_before, cash_after, account_revision_before, account_revision_after, linked_evidence_id, execution_id, operation_idempotency_key, operation_index, actor_user_id, actor_role, authority_source, created_at: now }
      state.accountingEvidence.push(row)
      return { rows: [row] }
    }
    if (text.startsWith('select evidence.* from atlas_paper_accounting_evidence')) {
      const [organization_id, team_workspace_id, account_id, user_id] = params
      const accountIds = state.accounts.filter((row) => row.organization_id === organization_id && row.team_workspace_id === team_workspace_id && row.account_id === account_id && row.user_id === user_id).map((row) => row.id)
      return { rows: state.accountingEvidence.filter((row) => accountIds.includes(row.account_record_id) && row.event_kind !== 'EXECUTION').sort((a, b) => a.account_revision_after - b.account_revision_after) }
    }
    if (text.startsWith('select * from atlas_paper_accounting_evidence') && text.includes('operation_idempotency_key=$2')) {
      const [account_record_id, key] = params
      return { rows: state.accountingEvidence.filter((row) => row.account_record_id === account_record_id && row.operation_idempotency_key === key).sort((a, b) => a.operation_index - b.operation_index) }
    }
    if (text.startsWith('select * from atlas_paper_accounting_evidence') && text.includes('where id=$1')) {
      const [id, account_record_id, organization_id, team_workspace_id, account_id, user_id] = params
      return { rows: state.accountingEvidence.filter((row) => row.id === id && row.account_record_id === account_record_id && row.organization_id === organization_id && row.team_workspace_id === team_workspace_id && row.account_id === account_id && row.user_id === user_id) }
    }
    if (text.startsWith('select id from atlas_paper_accounting_evidence')) {
      const [account_record_id, linked_evidence_id] = params
      return { rows: state.accountingEvidence.filter((row) => row.account_record_id === account_record_id && row.linked_evidence_id === linked_evidence_id && row.event_kind === 'EXTERNAL_REVERSAL').map(({ id }) => ({ id })) }
    }
    if (text.startsWith('select * from atlas_paper_accounting_evidence')) {
      const [account_record_id, organization_id, team_workspace_id, account_id, user_id] = params
      return { rows: state.accountingEvidence.filter((row) => row.account_record_id === account_record_id && row.organization_id === organization_id && row.team_workspace_id === team_workspace_id && row.account_id === account_id && row.user_id === user_id).sort((a, b) => a.account_revision_after - b.account_revision_after) }
    }
    if (text.includes('from atlas_ai_opportunity_analysis_history')) return { rows: [{ id: text.includes("analysis_category='paper_evaluation'") ? 'evaluation-row' : 'intent-row' }] }
    if (text.startsWith('select * from atlas_paper_positions')) return { rows: state.positions.filter((row) => row.account_record_id === params[0] && row.status === 'open') }
    if (text.startsWith('select * from atlas_paper_executions')) {
      const [account_record_id, fingerprint] = params
      return { rows: state.executions.filter((row) => row.account_record_id === account_record_id && (fingerprint == null || row.idempotency_fingerprint === fingerprint)) }
    }
    if (text.startsWith('select id,cash_impact from atlas_paper_executions')) {
      const [account_record_id, organization_id, team_workspace_id, account_id, user_id] = params
      return { rows: state.executions.filter((row) => row.account_record_id === account_record_id && row.organization_id === organization_id && row.team_workspace_id === team_workspace_id && row.account_id === account_id && row.user_id === user_id).map(({ id, cash_impact }) => ({ id, cash_impact })) }
    }
    if (text.startsWith('insert into atlas_paper_executions')) {
      const row = { id: params[0], account_record_id: params[1], organization_id: params[2], team_workspace_id: params[3], account_id: params[4], user_id: params[5], position_id: params[6], execution_type: 'entry', idempotency_fingerprint: params[7], cash_impact: params[19], payload: params[22], created_at: now }
      state.executions.push(row)
      return { rows: [row] }
    }
    if (text.startsWith('insert into atlas_paper_positions')) {
      const row = { id: params[0], account_record_id: params[1], organization_id: params[2], team_workspace_id: params[3], account_id: params[4], user_id: params[5], symbol: params[6], asset_type: params[7], side: params[8], quantity: params[9], average_cost: params[10], current_price: params[11], mark_evidence_timestamp: params[12], risk_state: params[13], realized_pnl: params[14], originating_candidate_id: params[15], originating_evaluation_id: params[16], originating_intent_fingerprint: params[17], strategy_id: params[18], status: 'open', revision: 0, created_at: now, updated_at: now }
      state.positions.push(row)
      return { rows: [row] }
    }
    throw new Error(`Unhandled Slice 2A test SQL: ${text}`)
  }
}

async function repositories(database = new Slice2AHarness(), accountScope = scope()) {
  const ledger = createCanonicalPaperLedgerRepository({ database })
  await ledger.getOrCreateAccount(accountScope)
  return { database, ledger, accounting: createAccountingEvidenceRepository({ database }) }
}

describe('Phase 2 Slice 2A durable funding and accounting origin evidence', () => {
  it('creates opening funding exactly once and atomically with a new canonical account', async () => {
    const { database, ledger } = await repositories()
    await ledger.getOrCreateAccount(scope())
    expect(database.state.accounts).toHaveLength(1)
    expect(database.state.accountingEvidence).toMatchObject([{ event_kind: 'OPENING_FUNDING', amount: DEFAULT_INITIAL_PAPER_BALANCE, cash_before: 0, cash_after: DEFAULT_INITIAL_PAPER_BALANCE, account_revision_before: -1, account_revision_after: 0, authority_source: 'system_account_creation' }])

    const failing = new Slice2AHarness()
    failing.failPattern = 'insert into atlas_paper_accounting_evidence'
    await expect(createCanonicalPaperLedgerRepository({ database: failing }).getOrCreateAccount(scope())).rejects.toThrow('injected atomicity failure')
    expect(failing.state.accounts).toHaveLength(0)
  })

  it('commits deposits and withdrawals atomically, suppresses retries, and rejects forged authority or invalid withdrawals', async () => {
    const { database, accounting } = await repositories()
    const depositInput = { ...scope(), authority, request: { kind: 'DEPOSIT', amount: 500, idempotencyKey: 'deposit-request-001' } }
    expect(await accounting.commitExternalFunding(depositInput)).toMatchObject({ duplicate: false, account: { cash: 100500, revision: 1 }, evidence: { eventKind: 'EXTERNAL_DEPOSIT', amount: 500 } })
    expect(await createAccountingEvidenceRepository({ database }).commitExternalFunding(depositInput)).toMatchObject({ duplicate: true, account: { cash: 100500, revision: 1 } })
    expect(await accounting.commitExternalFunding({ ...scope(), authority, request: { kind: 'WITHDRAWAL', amount: -125, idempotencyKey: 'withdraw-request-001' } })).toMatchObject({ account: { cash: 100375, revision: 2 }, evidence: { eventKind: 'EXTERNAL_WITHDRAWAL' } })
    await expect(accounting.commitExternalFunding({ ...scope(), authority, request: { kind: 'WITHDRAWAL', amount: -200000, idempotencyKey: 'withdraw-request-002' } })).rejects.toMatchObject({ code: 'paper_external_funding_insufficient_funds' })
    await expect(accounting.commitExternalFunding({ ...scope(), authority: { source: 'copilot', principalType: 'ai', userId: 'user-a', role: 'owner' }, request: { kind: 'DEPOSIT', amount: 1, idempotencyKey: 'copilot-request-001' } })).rejects.toMatchObject({ code: 'paper_external_funding_authority_denied' })
    await expect(accounting.commitExternalFunding({ ...scope(), authority, request: { kind: 'DEPOSIT', amount: 1, idempotencyKey: 'forged-request-001', cashAfter: 1 } })).rejects.toMatchObject({ code: 'paper_external_funding_request_invalid' })

    const before = structuredClone(database.state)
    database.failPattern = 'insert into atlas_paper_accounting_evidence'
    await expect(accounting.commitExternalFunding({ ...scope(), authority, request: { kind: 'DEPOSIT', amount: 10, idempotencyKey: 'atomic-request-001' } })).rejects.toThrow('injected atomicity failure')
    expect(database.state).toEqual(before)
  })

  it('serializes concurrent external mutations under the canonical account lock', async () => {
    const { database } = await repositories()
    const one = createAccountingEvidenceRepository({ database })
    const two = createAccountingEvidenceRepository({ database })
    await Promise.all([
      one.commitExternalFunding({ ...scope(), authority, request: { kind: 'DEPOSIT', amount: 25, idempotencyKey: 'concurrent-request-001' } }),
      two.commitExternalFunding({ ...scope(), authority, request: { kind: 'DEPOSIT', amount: 75, idempotencyKey: 'concurrent-request-002' } }),
    ])
    expect(database.state.accounts[0]).toMatchObject({ cash: 100100, revision: 2 })
    expect(database.state.accountingEvidence.map((row) => row.account_revision_after)).toEqual([0, 1, 2])
  })

  it('keeps funding evidence tenant/account isolated', async () => {
    const database = new Slice2AHarness()
    const a = await repositories(database, scope())
    const scopeB = scope({ tenantContext: { organizationId: 'org-b', teamWorkspaceId: 'workspace-a', userId: 'user-a' }, accountId: 'paper-b' })
    await a.ledger.getOrCreateAccount(scopeB)
    await a.accounting.commitExternalFunding({ ...scope(), authority, request: { kind: 'DEPOSIT', amount: 50, idempotencyKey: 'isolated-request-001' } })
    expect(await a.accounting.listExternalFunding(scope())).toHaveLength(2)
    expect(await a.accounting.listExternalFunding(scopeB)).toHaveLength(1)
    const tenantADeposit = database.state.accountingEvidence.find((row) => row.event_kind === 'EXTERNAL_DEPOSIT')
    await expect(a.accounting.correctExternalFunding({ ...scopeB, authority, request: { originalEvidenceId: tenantADeposit.id, replacementAmount: 40, idempotencyKey: 'cross-tenant-correction-001' } })).rejects.toMatchObject({ code: 'paper_external_funding_request_invalid' })
  })

  it('records linked reversal and replacement evidence and reconstructs after repository restart', async () => {
    const { database, accounting } = await repositories()
    const deposit = await accounting.commitExternalFunding({ ...scope(), authority, request: { kind: 'DEPOSIT', amount: 500, idempotencyKey: 'correction-source-001' } })
    const corrected = await accounting.correctExternalFunding({ ...scope(), authority, request: { originalEvidenceId: deposit.evidence.evidenceId, replacementAmount: 300, idempotencyKey: 'correction-request-001' } })
    expect(corrected).toMatchObject({ account: { cash: 100300, revision: 3 }, reversal: { eventKind: 'EXTERNAL_REVERSAL', amount: -500, linkedEvidenceId: deposit.evidence.evidenceId }, replacement: { eventKind: 'EXTERNAL_REPLACEMENT', amount: 300, linkedEvidenceId: deposit.evidence.evidenceId } })
    expect(await accounting.correctExternalFunding({ ...scope(), authority, request: { originalEvidenceId: deposit.evidence.evidenceId, replacementAmount: 300, idempotencyKey: 'correction-request-001' } })).toMatchObject({ duplicate: true, account: { cash: 100300, revision: 3 } })
    expect(await createAccountingEvidenceRepository({ database }).reconcileAccount(scope())).toMatchObject({ status: 'COMPLETE', provenOrigin: { cash: 100000, accountRevision: 0 }, externalCashFlows: 300, cumulativeFunding: 100300, reconstructedCash: 100300 })
  })

  it('never fabricates legacy origin and never reports unexplained cash or revision gaps complete', async () => {
    const legacy = new Slice2AHarness()
    legacy.state.accounts.push({ id: 'legacy-account', organization_id: 'org-a', team_workspace_id: 'workspace-a', account_id: 'paper-a', user_id: 'user-a', accounting_origin_id: null, cash: 100000, buying_power: 100000, equity: 100000, realized_pnl: 0, revision: 0, created_at: now, updated_at: now })
    legacy.state.accountingEvidence.push({ id: 'fabricated-opening', account_record_id: 'legacy-account', organization_id: 'org-a', team_workspace_id: 'workspace-a', account_id: 'paper-a', user_id: 'user-a', accounting_origin_id: 'fabricated', event_kind: 'OPENING_FUNDING', amount: 100000, cash_before: 0, cash_after: 100000, account_revision_before: -1, account_revision_after: 0, linked_evidence_id: null, execution_id: null, operation_idempotency_key: 'fabricated', operation_index: 0, actor_user_id: 'system', actor_role: 'system', authority_source: 'system_account_creation', created_at: now })
    expect(await createAccountingEvidenceRepository({ database: legacy }).reconcileAccount(scope())).toMatchObject({ status: 'UNAVAILABLE', reasons: ['LEGACY_ORIGIN_EVIDENCE_UNAVAILABLE'], provenOrigin: null, reconstructedCash: null })

    const { database, accounting } = await repositories()
    database.state.accounts[0].cash += 10
    database.state.accounts[0].revision += 1
    expect(await accounting.reconcileAccount(scope())).toMatchObject({ status: 'INCOMPLETE', reasons: expect.arrayContaining(['CURRENT_ACCOUNT_STATE_UNEXPLAINED']) })
  })

  it('preserves canonical execution cash accounting and maps it to one immutable revision event', async () => {
    const { database, ledger, accounting } = await repositories()
    const committed = await ledger.commitEntry({ ...scope(), simulation: entry(), now })
    expect(committed).toMatchObject({ duplicate: false, account: { cash: 98999, revision: 1 }, execution: { cashImpact: -1001 } })
    expect(database.state.accountingEvidence.filter((row) => row.event_kind === 'EXECUTION')).toMatchObject([{ amount: -1001, cash_before: 100000, cash_after: 98999, account_revision_before: 0, account_revision_after: 1 }])
    expect(await accounting.reconcileAccount(scope())).toMatchObject({ status: 'COMPLETE', executionCashImpacts: -1001, externalCashFlows: 0, reconstructedCash: 98999 })
  })

  it('registers additive append-only persistence without any legacy opening-history backfill', () => {
    const migration = readFileSync('lib/db/migrations.js', 'utf8')
    const start = migration.indexOf('202609260002_paper_accounting_origin_evidence')
    const section = migration.slice(start)
    expect(section).toContain('atlas_paper_accounting_evidence_append_only')
    expect(section).toContain('atlas_paper_accounting_origin_immutable')
    expect(section).toContain("WHERE event_kind='OPENING_FUNDING'")
    expect(section).toContain('UNIQUE (account_record_id, account_revision_after)')
    expect(section).toContain("authority_source='authenticated_human_request'")
    expect(section).toContain('FOREIGN KEY (account_record_id, organization_id, team_workspace_id, account_id, user_id)')
    expect(section).not.toMatch(/INSERT INTO atlas_paper_accounting_evidence[\s\S]*SELECT .*atlas_paper_accounts/i)
  })
})
