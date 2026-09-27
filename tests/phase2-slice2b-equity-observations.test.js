import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { calculateCanonicalSignedMarkedValue, createCanonicalPaperLedgerRepository } from '../lib/opportunities/persistence/canonicalPaperLedgerRepository.js'
import {
  createEquityObservationRepository,
  EQUITY_VALUATION_POLICY_VERSION,
} from '../lib/opportunities/persistence/equityObservationRepository.js'

const NOW = '2026-09-26T12:00:00.000Z'
const scope = (overrides = {}) => ({
  tenantContext: { organizationId: 'org-a', teamWorkspaceId: 'workspace-a', userId: 'user-a' },
  accountId: 'paper-a',
  userId: 'user-a',
  request: { idempotencyKey: 'observation-request-001' },
  ...overrides,
})

function position(overrides = {}) {
  return {
    id: 'position-aapl-long', account_record_id: 'account-a', organization_id: 'org-a', team_workspace_id: 'workspace-a',
    account_id: 'paper-a', user_id: 'user-a', symbol: 'AAPL', asset_type: 'equity', side: 'long', quantity: 10,
    average_cost: 95, current_price: 95, mark_evidence_timestamp: NOW, status: 'open', revision: 3,
    ...overrides,
  }
}

function quote(symbol, overrides = {}) {
  const assetType = overrides.assetType ?? 'equity'
  const observedAt = overrides.updatedAt ?? NOW
  const provider = overrides.provider ?? 'twelvedata'
  return {
    symbol, assetType, price: 100, updatedAt: observedAt, provider,
    provenance: {
      provider, dataStatus: 'LIVE', observedAt, receivedAt: NOW, fallbackUsed: false,
      mock: false, delayed: false, warningCodes: [], sourceCount: 1,
    },
    ...overrides,
  }
}

class Slice2BHarness {
  constructor({ positions = [] } = {}) {
    this.connected = true
    this.state = {
      accounts: [{
        id: 'account-a', organization_id: 'org-a', team_workspace_id: 'workspace-a', account_id: 'paper-a', user_id: 'user-a',
        accounting_origin_id: 'origin-a', cash: 100000, buying_power: 100000, equity: 100000, realized_pnl: 0,
        revision: 0, created_at: NOW, updated_at: NOW,
      }],
      positions: structuredClone(positions),
      executions: [],
      evidence: [{
        id: 'funding-opening', account_record_id: 'account-a', organization_id: 'org-a', team_workspace_id: 'workspace-a',
        account_id: 'paper-a', user_id: 'user-a', accounting_origin_id: 'origin-a', event_kind: 'OPENING_FUNDING',
        amount: 100000, cash_before: 0, cash_after: 100000, account_revision_before: -1, account_revision_after: 0,
        linked_evidence_id: null, execution_id: null, operation_idempotency_key: 'system:canonical-account-opening',
        operation_index: 0, actor_user_id: 'system', actor_role: 'system', authority_source: 'system_account_creation', created_at: NOW,
      }],
      observations: [],
    }
    this.activeDraft = null
    this.failObservationInsert = false
  }

  async query(sql, params = []) { return this.#run(this.state, sql, params) }

  async transaction(callback) {
    const draft = structuredClone(this.state)
    this.activeDraft = draft
    try {
      const result = await callback({ query: (sql, params = []) => this.#run(draft, sql, params) })
      this.state = draft
      return result
    } finally {
      this.activeDraft = null
    }
  }

  mutateDuringCollection(callback) {
    if (!this.activeDraft) throw new Error('no active observation transaction')
    callback(this.activeDraft)
  }

  deposit(amount, suffix) {
    const account = this.state.accounts[0]
    const before = account.cash
    const beforeRevision = account.revision
    account.cash += amount
    account.buying_power += amount
    account.equity += amount
    account.revision += 1
    this.state.evidence.push({
      id: `funding-${suffix}`, account_record_id: account.id, organization_id: account.organization_id,
      team_workspace_id: account.team_workspace_id, account_id: account.account_id, user_id: account.user_id,
      accounting_origin_id: account.accounting_origin_id, event_kind: 'EXTERNAL_DEPOSIT', amount,
      cash_before: before, cash_after: account.cash, account_revision_before: beforeRevision,
      account_revision_after: account.revision, linked_evidence_id: null, execution_id: null,
      operation_idempotency_key: `deposit-${suffix}`, operation_index: 0, actor_user_id: account.user_id,
      actor_role: 'owner', authority_source: 'authenticated_human_request', created_at: NOW,
    })
  }

  #run(state, sql, params) {
    const text = sql.replace(/\s+/g, ' ').trim().toLowerCase()
    if (text.startsWith('insert into atlas_paper_accounts')) return { rows: [] }
    if (text.startsWith('select * from atlas_paper_accounts')) {
      const [organization_id, team_workspace_id, account_id, user_id] = params
      return { rows: state.accounts.filter((row) => row.organization_id === organization_id && row.team_workspace_id === team_workspace_id && row.account_id === account_id && row.user_id === user_id) }
    }
    if (text.startsWith('select * from atlas_paper_positions')) {
      const [account_record_id] = params
      return { rows: state.positions.filter((row) => row.account_record_id === account_record_id && row.status === 'open').sort((a, b) => `${a.symbol}:${a.asset_type}:${a.side}:${a.id}`.localeCompare(`${b.symbol}:${b.asset_type}:${b.side}:${b.id}`)) }
    }
    if (text.startsWith('select * from atlas_paper_accounting_evidence')) {
      const [account_record_id, organization_id, team_workspace_id, account_id, user_id] = params
      return { rows: state.evidence.filter((row) => row.account_record_id === account_record_id && row.organization_id === organization_id && row.team_workspace_id === team_workspace_id && row.account_id === account_id && row.user_id === user_id).sort((a, b) => a.account_revision_after - b.account_revision_after || a.id.localeCompare(b.id)) }
    }
    if (text.startsWith('select id,cash_impact from atlas_paper_executions')) {
      const [account_record_id, organization_id, team_workspace_id, account_id, user_id] = params
      return { rows: state.executions.filter((row) => row.account_record_id === account_record_id && row.organization_id === organization_id && row.team_workspace_id === team_workspace_id && row.account_id === account_id && row.user_id === user_id).map(({ id, cash_impact }) => ({ id, cash_impact })) }
    }
    if (text.startsWith('select * from atlas_paper_equity_observations') && text.includes('operation_idempotency_key=$2')) {
      const [account_record_id, key] = params
      return { rows: state.observations.filter((row) => row.account_record_id === account_record_id && row.operation_idempotency_key === key) }
    }
    if (text.startsWith('select coalesce(max(observation_order),0)')) {
      const latest = state.observations.filter((row) => row.account_record_id === params[0]).reduce((max, row) => Math.max(max, row.observation_order), 0)
      return { rows: [{ latest_order: latest }] }
    }
    if (text.startsWith('insert into atlas_paper_equity_observations')) {
      if (this.failObservationInsert) throw new Error('injected observation persistence failure')
      const [id, account_record_id, organization_id, team_workspace_id, account_id, user_id, account_revision,
        observation_order, valuation_timestamp, accounting_origin_id, accounting_cutoff_evidence_id,
        accounting_cutoff_revision, funding_cutoff_evidence_id, funding_cutoff_revision, canonical_cash,
        denomination, position_manifest, signed_marked_value, equity, valuation_policy_version,
        completeness_status, reasons, operation_idempotency_key] = params
      const row = {
        id, account_record_id, organization_id, team_workspace_id, account_id, user_id, account_revision,
        observation_order, valuation_timestamp, recorded_at: NOW, accounting_origin_id,
        accounting_cutoff_evidence_id, accounting_cutoff_revision, funding_cutoff_evidence_id,
        funding_cutoff_revision, canonical_cash, denomination, position_manifest, signed_marked_value, equity,
        valuation_policy_version, completeness_status, reasons, operation_idempotency_key,
      }
      state.observations.push(row)
      return { rows: [row] }
    }
    if (text.startsWith('select * from atlas_paper_equity_observations')) {
      const [organization_id, team_workspace_id, account_id, user_id] = params
      return { rows: state.observations.filter((row) => row.organization_id === organization_id && row.team_workspace_id === team_workspace_id && row.account_id === account_id && row.user_id === user_id).sort((a, b) => a.observation_order - b.observation_order) }
    }
    throw new Error(`Unhandled Slice 2B test SQL: ${text}`)
  }
}

function repository(database, marks = {}) {
  const marketDataService = {
    getQuote: vi.fn(async (symbol, options) => {
      const value = marks[symbol]
      if (typeof value === 'function') return value(symbol, options)
      return value ?? quote(symbol, { assetType: options.assetType })
    }),
  }
  return { repository: createEquityObservationRepository({ database, marketDataService, clock: () => new Date(NOW) }), marketDataService }
}

describe('Phase 2 Slice 2B durable complete equity observations', () => {
  it('persists a complete cash-only observation without requesting quotes', async () => {
    const database = new Slice2BHarness()
    const { repository: observations, marketDataService } = repository(database)
    const result = await observations.observe(scope())
    expect(result).toMatchObject({ duplicate: false, observation: {
      observationOrder: 1, accountRevision: 0, valuationTimestamp: NOW, recordedAt: NOW,
      accountingOriginId: 'origin-a', accountingCutoff: { evidenceId: 'funding-opening', revision: 0 },
      fundingCutoff: { evidenceId: 'funding-opening', revision: 0 }, canonicalCash: 100000,
      denomination: 'USD', positionManifest: { status: 'COMPLETE', count: 0, positions: [] },
      signedMarkedValue: 0, equity: 100000, valuationPolicyVersion: EQUITY_VALUATION_POLICY_VERSION,
      completenessStatus: 'COMPLETE', reasons: [],
    } })
    expect(marketDataService.getQuote).not.toHaveBeenCalled()
  })

  it('persists a complete multi-position manifest with signed long/short marks, canonical multipliers, and provenance', async () => {
    const database = new Slice2BHarness({ positions: [
      position(),
      position({ id: 'position-spy-short-option', symbol: 'SPY-PUT', asset_type: 'options', side: 'short', quantity: 2, revision: 1 }),
    ] })
    const { repository: observations } = repository(database, {
      AAPL: quote('AAPL', { price: 110 }),
      'SPY-PUT': quote('SPY-PUT', { assetType: 'options', price: 3 }),
    })
    const { observation } = await observations.observe(scope())
    expect(observation).toMatchObject({ completenessStatus: 'COMPLETE', signedMarkedValue: 500, equity: 100500 })
    expect(observation.positionManifest.positions).toMatchObject([
      { positionId: 'position-aapl-long', instrument: { identity: 'equity:AAPL' }, side: 'long', quantity: 10, multiplier: 1, denomination: 'USD', mark: { price: 110, timestamp: NOW, provider: 'twelvedata', fallbackUsed: false, mock: false, dataStatus: 'LIVE', sourceProvenance: { sourceCount: 1 } } },
      { positionId: 'position-spy-short-option', instrument: { identity: 'options:SPY-PUT' }, side: 'short', quantity: 2, multiplier: 100, denomination: 'USD', mark: { price: 3, provider: 'twelvedata' } },
    ])
    expect(calculateCanonicalSignedMarkedValue([
      { assetType: 'equity', side: 'long', quantity: 10, currentPrice: 110 },
      { assetType: 'options', side: 'short', quantity: 2, currentPrice: 3 },
    ])).toBe(500)
  })

  it('leaves the existing canonical valuation and risk-state behavior unchanged', async () => {
    const database = new Slice2BHarness({ positions: [
      position({ risk_state: { version: 'canonical-paper-risk-commitment-v2', status: 'KNOWN', openRisk: 25, source: 'canonical_fill_to_deterministic_stop_exit_risk' } }),
      position({ id: 'position-spy-short-option', symbol: 'SPY-PUT', asset_type: 'options', side: 'short', quantity: 2, revision: 1, risk_state: { version: 'canonical-paper-risk-commitment-v2', status: 'KNOWN', openRisk: 40, source: 'canonical_fill_to_deterministic_stop_exit_risk' } }),
    ] })
    const ledger = createCanonicalPaperLedgerRepository({ database })
    const canonical = await ledger.getCanonicalState({
      tenantContext: scope().tenantContext,
      accountId: 'paper-a', userId: 'user-a', now: NOW,
      marks: [
        { symbol: 'AAPL', price: 110, updatedAt: NOW },
        { symbol: 'SPY-PUT', price: 3, updatedAt: NOW },
      ],
    })
    expect(canonical.valuation).toMatchObject({ status: 'RECONCILED', cash: 100000, signedMarkedValue: 500, equity: 100500, accountRevision: 0, markedAt: NOW })
    expect(canonical.riskState).toEqual({ status: 'KNOWN', unknownPositionIds: [] })
    expect(canonical.risk.state).toBe('KNOWN')
  })

  it.each([
    ['stale', quote('AAPL', { updatedAt: '2026-09-26T11:54:59.000Z' }), 'STALE_MARK'],
    ['missing', null, 'MISSING_MARK'],
    ['fallback', quote('AAPL', { provenance: { provider: 'twelvedata', dataStatus: 'DEGRADED', observedAt: NOW, receivedAt: NOW, fallbackUsed: true, mock: false, sourceCount: 1 } }), 'FALLBACK_OR_MOCK_MARK'],
    ['future', quote('AAPL', { updatedAt: '2026-09-26T12:00:01.000Z' }), 'FUTURE_DATED_MARK'],
    ['provenance-free', quote('AAPL', { provider: 'unknown', provenance: { provider: 'unknown', dataStatus: 'UNKNOWN', observedAt: NOW, sourceCount: 0 } }), 'MISSING_PROVIDER_PROVENANCE'],
    ['invalid-numeric', quote('AAPL', { price: Number.NaN }), 'INVALID_MARK_NUMERIC'],
  ])('fails closed for a %s authoritative mark', async (_label, mark, reason) => {
    const database = new Slice2BHarness({ positions: [position()] })
    const { repository: observations } = repository(database, { AAPL: mark === null ? async () => null : mark })
    const { observation } = await observations.observe(scope())
    expect(observation.completenessStatus).toBe('UNAVAILABLE')
    expect(observation.equity).toBeNull()
    expect(observation.signedMarkedValue).toBeNull()
    expect(observation.reasons.some((value) => value.startsWith(reason))).toBe(true)
  })

  it('fails closed for incomplete position evidence and unsupported denomination/liability models', async () => {
    const database = new Slice2BHarness({ positions: [
      position({ id: '', user_id: 'user-a' }),
      position({ id: 'position-eurusd', symbol: 'EUR/USD', asset_type: 'forex' }),
    ] })
    const { repository: observations } = repository(database)
    const { observation } = await observations.observe(scope())
    expect(observation).toMatchObject({ completenessStatus: 'INCOMPLETE', equity: null, signedMarkedValue: null, positionManifest: { status: 'INCOMPLETE', count: 2 } })
    expect(observation.reasons).toEqual(expect.arrayContaining([
      expect.stringMatching(/^INCOMPLETE_POSITION_EVIDENCE:/),
      expect.stringMatching(/^UNSUPPORTED_DENOMINATION_OR_LIABILITY_MODEL:/),
    ]))
  })

  it('fails closed when Slice 2A accounting origin or revision history is unavailable', async () => {
    const database = new Slice2BHarness()
    database.state.accounts[0].accounting_origin_id = null
    database.state.evidence = []
    const { repository: observations } = repository(database)
    const { observation } = await observations.observe(scope())
    expect(observation).toMatchObject({ completenessStatus: 'UNAVAILABLE', accountingOriginId: null, accountingCutoff: null, fundingCutoff: null, equity: null })
    expect(observation.reasons).toEqual(expect.arrayContaining(['ACCOUNTING_ORIGIN_UNAVAILABLE', 'OPENING_FUNDING_EVIDENCE_COUNT_INVALID', 'CURRENT_ACCOUNT_STATE_UNEXPLAINED']))
  })

  it('cannot publish COMPLETE when the locked account revision changes during mark collection', async () => {
    const database = new Slice2BHarness({ positions: [position()] })
    const { repository: observations } = repository(database, {
      AAPL: () => {
        database.mutateDuringCollection((draft) => { draft.accounts[0].cash += 25; draft.accounts[0].revision += 1 })
        return quote('AAPL')
      },
    })
    const { observation } = await observations.observe(scope())
    expect(observation).toMatchObject({ accountRevision: 0, canonicalCash: 100000, completenessStatus: 'INCOMPLETE', equity: null })
    expect(observation.reasons).toContain('ACCOUNT_REVISION_RACE')
  })

  it('serializes Slice 2A funding into exact before/after cutoffs rather than wall-clock inference', async () => {
    const database = new Slice2BHarness()
    database.deposit(500, 'before')
    const { repository: observations } = repository(database)
    const first = await observations.observe(scope())
    database.deposit(250, 'after')
    const second = await observations.observe(scope({ request: { idempotencyKey: 'observation-request-002' } }))
    expect(first.observation).toMatchObject({ accountRevision: 1, canonicalCash: 100500, fundingCutoff: { evidenceId: 'funding-before', revision: 1 }, equity: 100500 })
    expect(second.observation).toMatchObject({ observationOrder: 2, accountRevision: 2, canonicalCash: 100750, fundingCutoff: { evidenceId: 'funding-after', revision: 2 }, equity: 100750 })
    expect(first.observation.recordedAt).toBe(second.observation.recordedAt)
  })

  it('makes retries idempotent while assigning deterministic distinct order at one account revision', async () => {
    const database = new Slice2BHarness()
    const { repository: observations } = repository(database)
    const first = await observations.observe(scope())
    const retry = await observations.observe(scope())
    const distinct = await observations.observe(scope({ request: { idempotencyKey: 'observation-request-002' } }))
    expect(retry).toMatchObject({ duplicate: true, observation: { observationId: first.observation.observationId, observationOrder: 1 } })
    expect(distinct).toMatchObject({ duplicate: false, observation: { accountRevision: 0, observationOrder: 2 } })
    expect(database.state.observations).toHaveLength(2)
  })

  it('preserves the full immutable evidence contract across repository restart/readback', async () => {
    const database = new Slice2BHarness({ positions: [position()] })
    const firstRepository = repository(database, { AAPL: quote('AAPL', { price: 107 }) }).repository
    const created = await firstRepository.observe(scope())
    const restarted = repository(database).repository
    const [readback] = await restarted.list(scope())
    expect(readback).toEqual(created.observation)
    const migration = readFileSync('lib/db/migrations.js', 'utf8')
    const section = migration.slice(migration.indexOf('202609260003_durable_complete_equity_observations'))
    expect(section).toContain('atlas_paper_equity_observations_append_only')
    expect(section).toContain('UNIQUE (account_record_id, observation_order)')
    expect(section).toContain('UNIQUE (account_record_id, operation_idempotency_key)')
    expect(section).toContain('FOREIGN KEY (accounting_cutoff_evidence_id, account_record_id)')
  })

  it('gives request and AI/Copilot supplied valuation evidence no authority', async () => {
    const database = new Slice2BHarness()
    const { repository: observations } = repository(database)
    await expect(observations.observe(scope({ request: { idempotencyKey: 'forged-observation-001', equity: 1, marks: [{ price: 1 }] } }))).rejects.toMatchObject({ code: 'paper_equity_observation_request_invalid' })
    await expect(observations.observe({
      ...scope({ request: { idempotencyKey: 'copilot-observation-001' } }),
      authority: { principalType: 'ai', source: 'copilot' },
      marks: [{ symbol: 'AAPL', price: 999999 }],
    })).rejects.toMatchObject({ code: 'paper_equity_observation_request_invalid' })
    expect(database.state.observations).toHaveLength(0)
  })

  it('does not create a valid or durable observation when persistence fails', async () => {
    const database = new Slice2BHarness()
    database.failObservationInsert = true
    const { repository: observations } = repository(database)
    await expect(observations.observe(scope())).rejects.toThrow('injected observation persistence failure')
    expect(database.state.observations).toHaveLength(0)
  })
})
