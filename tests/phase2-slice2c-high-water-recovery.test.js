import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  createPaperHighWaterRepository,
  HIGH_WATER_ACCOUNTING_CONTRACT_VERSION,
} from '../lib/opportunities/persistence/paperHighWaterRepository.js'
import { EQUITY_VALUATION_POLICY_VERSION } from '../lib/opportunities/persistence/equityObservationRepository.js'

const NOW = '2026-09-26T12:00:00.000Z'

function scope(overrides = {}) {
  return {
    tenantContext: { organizationId: 'org-a', teamWorkspaceId: 'workspace-a', userId: 'user-a' },
    accountId: 'paper-a',
    userId: 'user-a',
    ...overrides,
  }
}

class Slice2CHarness {
  constructor() {
    this.connected = true
    this.state = { accounts: [], evidence: [], executions: [], observations: [], checkpoints: [] }
    this.addAccount()
  }

  addAccount({ suffix = 'a', organizationId = `org-${suffix}`, workspaceId = `workspace-${suffix}`, userId = `user-${suffix}` } = {}) {
    const account = {
      id: `account-${suffix}`, organization_id: organizationId, team_workspace_id: workspaceId,
      account_id: `paper-${suffix}`, user_id: userId, accounting_origin_id: `origin-${suffix}`,
      cash: 100000, buying_power: 100000, equity: 100000, revision: 0,
    }
    this.state.accounts.push(account)
    this.state.evidence.push({
      id: `funding-opening-${suffix}`, account_record_id: account.id, organization_id: organizationId,
      team_workspace_id: workspaceId, account_id: account.account_id, user_id: userId,
      accounting_origin_id: account.accounting_origin_id, event_kind: 'OPENING_FUNDING', amount: 100000,
      cash_before: 0, cash_after: 100000, account_revision_before: -1, account_revision_after: 0,
      linked_evidence_id: null, execution_id: null, operation_idempotency_key: 'system:canonical-account-opening',
    })
    return account
  }

  account(suffix = 'a') { return this.state.accounts.find((row) => row.id === `account-${suffix}`) }

  externalFlow(amount, label, suffix = 'a') {
    const account = this.account(suffix)
    const before = account.cash
    const revisionBefore = account.revision
    account.cash += amount
    account.buying_power += amount
    account.equity += amount
    account.revision += 1
    this.state.evidence.push({
      id: `funding-${label}-${suffix}`, account_record_id: account.id, organization_id: account.organization_id,
      team_workspace_id: account.team_workspace_id, account_id: account.account_id, user_id: account.user_id,
      accounting_origin_id: account.accounting_origin_id,
      event_kind: amount > 0 ? 'EXTERNAL_DEPOSIT' : 'EXTERNAL_WITHDRAWAL', amount,
      cash_before: before, cash_after: account.cash, account_revision_before: revisionBefore,
      account_revision_after: account.revision, linked_evidence_id: null, execution_id: null,
      operation_idempotency_key: `funding-${label}-${suffix}`,
    })
  }

  executionCash(amount, label, suffix = 'a') {
    const account = this.account(suffix)
    const before = account.cash
    const revisionBefore = account.revision
    account.cash += amount
    account.buying_power += amount
    account.equity += amount
    account.revision += 1
    const executionId = `execution-${label}-${suffix}`
    this.state.executions.push({
      id: executionId, account_record_id: account.id, organization_id: account.organization_id,
      team_workspace_id: account.team_workspace_id, account_id: account.account_id, user_id: account.user_id,
      cash_impact: amount,
    })
    this.state.evidence.push({
      id: `execution-evidence-${label}-${suffix}`, account_record_id: account.id, organization_id: account.organization_id,
      team_workspace_id: account.team_workspace_id, account_id: account.account_id, user_id: account.user_id,
      accounting_origin_id: account.accounting_origin_id, event_kind: 'EXECUTION', amount,
      cash_before: before, cash_after: account.cash, account_revision_before: revisionBefore,
      account_revision_after: account.revision, linked_evidence_id: null, execution_id: executionId,
      operation_idempotency_key: `execution:${executionId}`,
    })
  }

  observeNormalized(normalizedValue, { suffix = 'a', status = 'COMPLETE', reason = 'MISSING_MARK:test' } = {}) {
    const account = this.account(suffix)
    const accountEvidence = this.state.evidence
      .filter((row) => row.account_record_id === account.id)
      .sort((a, b) => a.account_revision_after - b.account_revision_after)
    const funding = accountEvidence.filter((row) => row.event_kind !== 'EXECUTION').reduce((sum, row) => sum + row.amount, 0)
    const equity = funding + normalizedValue
    const signedMarkedValue = equity - account.cash
    const order = this.state.observations.filter((row) => row.account_record_id === account.id).length + 1
    const accountingCutoff = accountEvidence.at(-1)
    const fundingCutoff = accountEvidence.filter((row) => row.event_kind !== 'EXECUTION').at(-1)
    let positions = []
    if (signedMarkedValue !== 0) {
      const side = signedMarkedValue > 0 ? 'long' : 'short'
      const price = Math.abs(signedMarkedValue)
      positions = [{
        positionId: `position-${order}-${suffix}`, positionRevision: 0,
        instrument: { symbol: `TEST${order}`, assetType: 'equity', identity: `equity:TEST${order}` },
        side, quantity: 1, multiplier: 1, denomination: 'USD',
        mark: {
          price, timestamp: NOW, provider: 'twelvedata', fallbackUsed: false, mock: false, dataStatus: 'LIVE',
          sourceProvenance: { provider: 'twelvedata', sourceCount: 1 },
        },
      }]
    }
    const complete = status === 'COMPLETE'
    const row = {
      id: `observation-${order}-${suffix}`, account_record_id: account.id, organization_id: account.organization_id,
      team_workspace_id: account.team_workspace_id, account_id: account.account_id, user_id: account.user_id,
      account_revision: account.revision, observation_order: order, valuation_timestamp: NOW, recorded_at: NOW,
      accounting_origin_id: account.accounting_origin_id, accounting_cutoff_evidence_id: accountingCutoff.id,
      accounting_cutoff_revision: accountingCutoff.account_revision_after, funding_cutoff_evidence_id: fundingCutoff.id,
      funding_cutoff_revision: fundingCutoff.account_revision_after, canonical_cash: account.cash, denomination: 'USD',
      position_manifest: { status: complete ? 'COMPLETE' : 'INCOMPLETE', count: positions.length, positions },
      signed_marked_value: complete ? signedMarkedValue : null, equity: complete ? equity : null,
      valuation_policy_version: EQUITY_VALUATION_POLICY_VERSION, completeness_status: status,
      reasons: complete ? [] : [reason], operation_idempotency_key: `observation-request-${order}-${suffix}`,
    }
    this.state.observations.push(row)
    return row.id
  }

  async query(sql, params = []) { return this.#run(this.state, sql, params) }

  async transaction(callback) {
    const draft = structuredClone(this.state)
    const result = await callback({ query: (sql, params = []) => this.#run(draft, sql, params) })
    this.state = draft
    return result
  }

  #run(state, sql, params) {
    const text = sql.replace(/\s+/g, ' ').trim().toLowerCase()
    if (text.startsWith('select * from atlas_paper_accounts')) {
      const [organizationId, workspaceId, accountId, userId] = params
      return { rows: state.accounts.filter((row) => row.organization_id === organizationId
        && row.team_workspace_id === workspaceId && row.account_id === accountId && row.user_id === userId) }
    }
    if (text.startsWith('select * from atlas_paper_accounting_evidence')) {
      const [accountRecordId, organizationId, workspaceId, accountId, userId] = params
      return { rows: state.evidence.filter((row) => row.account_record_id === accountRecordId
        && row.organization_id === organizationId && row.team_workspace_id === workspaceId
        && row.account_id === accountId && row.user_id === userId)
        .sort((a, b) => a.account_revision_after - b.account_revision_after || a.id.localeCompare(b.id)) }
    }
    if (text.startsWith('select id,cash_impact from atlas_paper_executions')) {
      const [accountRecordId, organizationId, workspaceId, accountId, userId] = params
      return { rows: state.executions.filter((row) => row.account_record_id === accountRecordId
        && row.organization_id === organizationId && row.team_workspace_id === workspaceId
        && row.account_id === accountId && row.user_id === userId).map(({ id, cash_impact }) => ({ id, cash_impact })) }
    }
    if (text.startsWith('select * from atlas_paper_equity_observations')) {
      const [accountRecordId, organizationId, workspaceId, accountId, userId] = params
      return { rows: state.observations.filter((row) => row.account_record_id === accountRecordId
        && row.organization_id === organizationId && row.team_workspace_id === workspaceId
        && row.account_id === accountId && row.user_id === userId).sort((a, b) => a.observation_order - b.observation_order) }
    }
    if (text.startsWith('select * from atlas_paper_high_water_checkpoints')) {
      const [accountRecordId, organizationId, workspaceId, accountId, userId] = params
      return { rows: state.checkpoints.filter((row) => row.account_record_id === accountRecordId
        && row.organization_id === organizationId && row.team_workspace_id === workspaceId
        && row.account_id === accountId && row.user_id === userId).sort((a, b) => a.checkpoint_order - b.checkpoint_order) }
    }
    if (text.startsWith('insert into atlas_paper_high_water_checkpoints')) {
      const [id, account_record_id, organization_id, team_workspace_id, account_id, user_id, accounting_origin_id,
        accounting_contract_version, checkpoint_order, checkpoint_revision, source_observation_id,
        source_observation_order, source_observation_revision, funding_cutoff_evidence_id, funding_cutoff_revision,
        cumulative_funding, normalized_value, high_water_value, high_water_observation_id,
        high_water_observation_order, predecessor_checkpoint_id, completeness_status, availability_status] = params
      const row = {
        id, account_record_id, organization_id, team_workspace_id, account_id, user_id, accounting_origin_id,
        accounting_contract_version, checkpoint_order, checkpoint_revision, source_observation_id,
        source_observation_order, source_observation_revision, funding_cutoff_evidence_id, funding_cutoff_revision,
        cumulative_funding, normalized_value, high_water_value, high_water_observation_id,
        high_water_observation_order, predecessor_checkpoint_id, completeness_status, availability_status,
        recorded_at: NOW,
      }
      if (state.checkpoints.some((item) => item.account_record_id === account_record_id
        && item.source_observation_id === source_observation_id)) throw new Error('duplicate checkpoint')
      state.checkpoints.push(row)
      return { rows: [row] }
    }
    throw new Error(`Unhandled Slice 2C test SQL: ${text}`)
  }
}

describe('Phase 2 Slice 2C cash-flow-neutral high-water and recovery', () => {
  it('establishes N/H, advances only for investment gain, and retains H through investment loss', async () => {
    const database = new Slice2CHarness()
    const highWater = createPaperHighWaterRepository({ database })
    const first = database.observeNormalized(0)
    let result = await highWater.advance({ ...scope(), sourceObservationId: first })
    expect(result.latestCheckpoint).toMatchObject({ cumulativeFunding: 100000, normalizedValue: 0, highWater: 0, drawdownAmount: 0 })

    const gain = database.observeNormalized(20000)
    result = await highWater.advance({ ...scope(), sourceObservationId: gain })
    expect(result.latestCheckpoint).toMatchObject({ normalizedValue: 20000, highWater: 20000, highWaterObservationId: gain, drawdownAmount: 0 })

    const loss = database.observeNormalized(-10000)
    result = await highWater.advance({ ...scope(), sourceObservationId: loss })
    expect(result.latestCheckpoint).toMatchObject({ normalizedValue: -10000, highWater: 20000, highWaterObservationId: gain, drawdownAmount: 30000 })
  })

  it('keeps N/H flow-neutral across pure deposit and withdrawal', async () => {
    const database = new Slice2CHarness()
    const highWater = createPaperHighWaterRepository({ database })
    await highWater.advance({ ...scope(), sourceObservationId: database.observeNormalized(5000) })
    database.externalFlow(25000, 'deposit')
    const afterDeposit = await highWater.advance({ ...scope(), sourceObservationId: database.observeNormalized(5000) })
    expect(afterDeposit.latestCheckpoint).toMatchObject({ cumulativeFunding: 125000, normalizedValue: 5000, highWater: 5000 })
    database.externalFlow(-10000, 'withdrawal')
    const afterWithdrawal = await highWater.advance({ ...scope(), sourceObservationId: database.observeNormalized(5000) })
    expect(afterWithdrawal.latestCheckpoint).toMatchObject({ cumulativeFunding: 115000, normalizedValue: 5000, highWater: 5000 })
  })

  it('separates funding from execution cash and investment movement', async () => {
    const database = new Slice2CHarness()
    const highWater = createPaperHighWaterRepository({ database })
    await highWater.advance({ ...scope(), sourceObservationId: database.observeNormalized(0) })
    database.externalFlow(10000, 'deposit')
    database.executionCash(-4000, 'buy')
    const result = await highWater.advance({ ...scope(), sourceObservationId: database.observeNormalized(7000) })
    expect(result.latestCheckpoint).toMatchObject({ cumulativeFunding: 110000, normalizedValue: 7000, highWater: 7000 })
  })

  it('does not advance on an incomplete observation and preserves historical H as unavailable', async () => {
    const database = new Slice2CHarness()
    const highWater = createPaperHighWaterRepository({ database })
    await highWater.advance({ ...scope(), sourceObservationId: database.observeNormalized(12000) })
    const incomplete = database.observeNormalized(0, { status: 'UNAVAILABLE' })
    const result = await highWater.advance({ ...scope(), sourceObservationId: incomplete })
    expect(result).toMatchObject({ status: 'UNAVAILABLE', historicalHighWater: 12000, currentNormalizedValue: null, currentDrawdownAmount: null })
    expect(database.state.checkpoints).toHaveLength(1)
  })

  it('preserves historical H but withholds current N/drawdown when the durable account changed without an observation', async () => {
    const database = new Slice2CHarness()
    const highWater = createPaperHighWaterRepository({ database })
    await highWater.advance({ ...scope(), sourceObservationId: database.observeNormalized(12000) })
    database.externalFlow(5000, 'unobserved-deposit')
    const recovered = await createPaperHighWaterRepository({ database }).recover(scope())
    expect(recovered).toMatchObject({
      status: 'UNAVAILABLE', reasons: ['CURRENT_OBSERVATION_MISSING'], historicalHighWater: 12000,
      latestNormalizedValue: 12000, currentNormalizedValue: null, currentDrawdownAmount: null,
    })
    expect(database.state.checkpoints).toHaveLength(1)
  })

  it('restarts, replays subsequent qualifying observations exactly, and makes duplicate retries idempotent', async () => {
    const database = new Slice2CHarness()
    let highWater = createPaperHighWaterRepository({ database })
    const first = database.observeNormalized(1000)
    await highWater.advance({ ...scope(), sourceObservationId: first })
    database.observeNormalized(-500)
    const gain = database.observeNormalized(2500)
    highWater = createPaperHighWaterRepository({ database })
    const recovered = await highWater.recover(scope())
    expect(recovered.progression.map((row) => [row.sourceObservationOrder, row.normalizedValue, row.highWater])).toEqual([
      [1, 1000, 1000], [2, -500, 1000], [3, 2500, 2500],
    ])
    const retry = await highWater.advance({ ...scope(), sourceObservationId: gain })
    expect(retry).toMatchObject({ duplicate: true, replayedCount: 0, latestCheckpoint: { normalizedValue: 2500, highWater: 2500 } })
    expect(database.state.checkpoints).toHaveLength(3)
  })

  it.each([
    ['missing origin', (database) => { database.state.accounts[0].accounting_origin_id = null }],
    ['revision gap', (database) => { database.state.evidence[0].account_revision_after = 1 }],
    ['unexplained cash', (database) => { database.state.accounts[0].cash += 1 }],
    ['execution mismatch', (database) => { database.state.executions.push({ id: 'orphan', account_record_id: 'account-a', organization_id: 'org-a', team_workspace_id: 'workspace-a', account_id: 'paper-a', user_id: 'user-a', cash_impact: -1 }) }],
    ['funding cutoff mismatch', (database) => { database.state.observations[0].funding_cutoff_evidence_id = 'missing-funding' }],
  ])('fails closed for a %s', async (_label, corrupt) => {
    const database = new Slice2CHarness()
    const observationId = database.observeNormalized(0)
    corrupt(database)
    await expect(createPaperHighWaterRepository({ database }).advance({ ...scope(), sourceObservationId: observationId }))
      .rejects.toMatchObject({ code: 'paper_high_water_recovery_failed' })
    expect(database.state.checkpoints).toHaveLength(0)
  })

  it('fails closed for an observation-order gap without inferring a missing mark', async () => {
    const database = new Slice2CHarness()
    const observationId = database.observeNormalized(0)
    database.state.observations[0].observation_order = 2
    await expect(createPaperHighWaterRepository({ database }).advance({ ...scope(), sourceObservationId: observationId }))
      .rejects.toMatchObject({ code: 'paper_high_water_recovery_failed' })
    expect(database.state.checkpoints).toHaveLength(0)
  })

  it.each([
    ['checkpoint value', (database) => { database.state.checkpoints[0].normalized_value += 1 }],
    ['checkpoint predecessor', (database) => { database.state.checkpoints[0].predecessor_checkpoint_id = 'invented' }],
    ['observation reference', (database) => { database.state.checkpoints[0].source_observation_id = 'missing-observation' }],
    ['observation numeric evidence', (database) => { database.state.observations[0].equity += 1 }],
    ['observation sub-cent numeric evidence', (database) => { database.state.observations[0].equity += 0.001 }],
    ['unsupported denomination', (database) => { database.state.observations[0].denomination = 'EUR' }],
  ])('fails closed for corrupt %s on recovery', async (_label, corrupt) => {
    const database = new Slice2CHarness()
    const highWater = createPaperHighWaterRepository({ database })
    await highWater.advance({ ...scope(), sourceObservationId: database.observeNormalized(1000) })
    corrupt(database)
    await expect(createPaperHighWaterRepository({ database }).recover(scope()))
      .rejects.toMatchObject({ code: 'paper_high_water_recovery_failed' })
  })

  it('isolates checkpoint state by tenant, workspace, account, and user', async () => {
    const database = new Slice2CHarness()
    database.addAccount({ suffix: 'b' })
    const highWater = createPaperHighWaterRepository({ database })
    const a = database.observeNormalized(1000)
    const b = database.observeNormalized(9000, { suffix: 'b' })
    await highWater.advance({ ...scope(), sourceObservationId: a })
    const resultB = await highWater.advance({ ...scope({
      tenantContext: { organizationId: 'org-b', teamWorkspaceId: 'workspace-b', userId: 'user-b' },
      accountId: 'paper-b', userId: 'user-b',
    }), sourceObservationId: b })
    expect(resultB.latestCheckpoint).toMatchObject({ normalizedValue: 9000, highWater: 9000 })
    expect(database.state.checkpoints.map((row) => [row.account_record_id, row.high_water_value])).toEqual([
      ['account-a', 1000], ['account-b', 9000],
    ])
  })

  it('keeps legacy incomplete history unavailable instead of manufacturing a baseline', async () => {
    const database = new Slice2CHarness()
    database.observeNormalized(0, { status: 'INCOMPLETE' })
    const laterComplete = database.observeNormalized(5000)
    const result = await createPaperHighWaterRepository({ database }).advance({ ...scope(), sourceObservationId: laterComplete })
    expect(result).toMatchObject({ status: 'UNAVAILABLE', reasons: ['LEGACY_INCOMPLETE_HISTORY'], historicalHighWater: null })
    expect(database.state.checkpoints).toHaveLength(0)
  })

  it('requires a fresh Slice 2B observation when recovery is asked for current valuation', async () => {
    const database = new Slice2CHarness()
    const highWater = createPaperHighWaterRepository({ database })
    await highWater.advance({ ...scope(), sourceObservationId: database.observeNormalized(1000) })
    await expect(highWater.recover({ ...scope(), currentValuationRequested: true }))
      .rejects.toMatchObject({ code: 'paper_high_water_fresh_observation_required' })
  })

  it('persists append-only revision-safe linkage without adding calendar or risk-latch authority', () => {
    const migration = readFileSync('lib/db/migrations.js', 'utf8')
    const repository = readFileSync('lib/opportunities/persistence/paperHighWaterRepository.js', 'utf8')
    const section = migration.slice(migration.indexOf('202609260004_cash_flow_neutral_high_water'))
    expect(section).toContain('atlas_paper_high_water_checkpoints_append_only')
    expect(section).toContain('UNIQUE (account_record_id, source_observation_id)')
    expect(section).toContain('FOREIGN KEY (predecessor_checkpoint_id, account_record_id)')
    expect(section).toContain(HIGH_WATER_ACCOUNTING_CONTRACT_VERSION)
    expect(`${section}\n${repository}`).not.toMatch(/daily_baseline|weekly_baseline|timezone_policy|day_boundary|week_boundary|risk_latch|live_readiness|shutdown_threshold/i)
    expect(repository).toContain('liveOrders: false')
    expect(repository).toContain('brokerExecution: false')
  })
})
