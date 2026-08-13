import { describe, expect, it, vi } from 'vitest'
import {
  buildDurablePaperWorkflowProjections,
  createDurableWorkspaceStateRepository,
  resolveDurableWorkspaceStateRepository,
} from '../lib/persistence/durablePaperWorkflowProjections.js'
import { createWorkspaceDataService } from '../lib/workspace/workspaceDataService.js'
import { createWorkspaceApiClient } from '../src/api/workspaceApiClient.js'
import { createAlertConfigurationsHandler } from '../netlify/functions/alert-configurations.js'
import { createScannerConfigurationsHandler } from '../netlify/functions/scanner-configurations.js'

const account = { cash: 100050, buyingPower: 100050, equity: 100050, realizedPnl: 50, revision: 4 }
const positions = [{ positionId: 'pos-1', symbol: 'AAPL', assetType: 'stock', side: 'long', quantity: 2, averagePrice: 100, currentPrice: 105, realizedPnl: 0, strategyId: 's1' }]
const executions = [
  { executionId: 'e1', executionType: 'entry', fingerprint: 'f1', symbol: 'AAPL', side: 'buy', quantity: 3, fillPrice: 100, fees: 0, cashImpact: -300, evidenceTimestamp: '2026-08-13T10:00:00.000Z', payload: {} },
  { executionId: 'e2', executionType: 'reduction', fingerprint: 'f2', symbol: 'AAPL', side: 'sell', quantity: 1, fillPrice: 150, fees: 0, cashImpact: 150, realizedPnlDelta: 50, evidenceTimestamp: '2026-08-13T11:00:00.000Z', payload: {} },
]

const userId = 'local-development:local-operator'
const membershipRepository = (role) => ({
  getMembership: vi.fn(async (organizationId) => organizationId === 'org-atlas-local'
    ? { id: `membership-${role}`, organizationId, userId, role, status: 'active' }
    : null),
})
const apiEvent = (method, body = {}, { role = 'owner', csrf = true, organizationId = 'org-atlas-local' } = {}) => ({
  httpMethod: method,
  headers: { authorization: 'Bearer dev-token', 'content-type': 'application/json', ...(csrf ? { 'x-csrf-token': 'test-csrf' } : {}), 'x-atlas-dev-role': role, 'x-atlas-dev-subject': 'local-operator' },
  queryStringParameters: { organizationId, accountId: 'paper-portfolio' },
  body: method === 'POST' ? JSON.stringify({ organizationId, accountId: 'paper-portfolio', ...body }) : '',
})
const response = (result) => ({ ...result, json: JSON.parse(result.body) })

describe('PI.4 durable paper workflow integration', () => {
  it('derives portfolio accounting from the canonical account and open positions', () => {
    const result = buildDurablePaperWorkflowProjections({ account, positions, executions, asOf: '2026-08-13T12:00:00.000Z' })
    expect(result).toMatchObject({ paperTrading: true, canonicalDurableSource: true, summary: { cash: 100050, realizedPnl: 50, revision: 4 } })
    expect(result.positions[0]).toMatchObject({ symbol: 'AAPL', quantity: 2, averageCost: 100, unrealizedPnl: 10 })
  })

  it('derives immutable journal rows from executions without a second ledger', () => {
    const result = buildDurablePaperWorkflowProjections({ account, positions, executions })
    expect(result.journal).toMatchObject({ immutableExecutionProjection: true })
    expect(result.journal.entries.map((entry) => entry.id)).toEqual(['e1', 'e2'])
    expect(result.journal.entries.every((entry) => entry.immutableSource && entry.paperTradingOnly)).toBe(true)
  })

  it('uses existing normalized journal evidence when it is present on an execution', () => {
    const result = buildDurablePaperWorkflowProjections({ account, positions, executions: [{ ...executions[1], payload: { journal: { notes: 'Normalized exit evidence', emotion: 'disciplined', tags: ['reviewed'], duration: '1h' } } }] })
    expect(result.journal.entries[0]).toMatchObject({ notes: 'Normalized exit evidence', emotion: 'disciplined', tags: ['reviewed'], duration: '1h' })
  })

  it('keeps PA.3 and PA.5 deterministic from the same realized executions', () => {
    const first = buildDurablePaperWorkflowProjections({ account, positions, executions, asOf: '2026-08-13T12:00:00.000Z' })
    const second = buildDurablePaperWorkflowProjections({ account, positions, executions, asOf: '2026-08-13T12:00:00.000Z' })
    expect(first.performance).toEqual(second.performance)
    expect(first.learning).toEqual(second.learning)
  })

  it('does not persist or invent fresh provider evidence in projections', () => {
    const result = buildDurablePaperWorkflowProjections({ account, positions, executions })
    expect(result.positions[0].priceProvenance).toMatchObject({ dataStatus: 'UNKNOWN', provider: 'durable-ledger' })
    expect(JSON.stringify(result)).not.toMatch(/rawCandles|providerPayload|apiKey/i)
  })

  it('fails closed when PostgreSQL durable state is unavailable', () => {
    expect(() => createDurableWorkspaceStateRepository({ database: { connected: false } })).toThrow(/unavailable/i)
    expect(() => resolveDurableWorkspaceStateRepository({ durableRepository: { persistenceMode: 'memory' }, env: { NODE_ENV: 'production' } })).toThrow(/prohibited|unavailable/i)
  })

  it('uses organization, team, account, and user predicates for durable reads', async () => {
    const database = { connected: true, query: vi.fn().mockResolvedValue({ rows: [{ payload: { id: 'scanner-1' } }] }) }
    const repository = createDurableWorkspaceStateRepository({ database })
    await repository.listScanners({ tenantContext: { organizationId: 'org-1', teamWorkspaceId: 'team-1' }, accountId: 'acct-1', userId: 'user-1' })
    expect(database.query.mock.calls[0][0]).toMatch(/organization_id=\$1[\s\S]*team_workspace_id[\s\S]*account_id=\$3 AND user_id=\$4/)
    expect(database.query.mock.calls[0][1]).toEqual(['org-1', 'team-1', 'acct-1', 'user-1'])
  })

  it('persists definitions and leaves scanner matches derived', async () => {
    const database = { connected: true, query: vi.fn().mockResolvedValue({ rows: [{ payload: { id: 'scanner-1', name: 'Momentum' } }] }) }
    const repository = createDurableWorkspaceStateRepository({ database })
    const result = await repository.saveScanner({ tenantContext: { organizationId: 'org-1' }, accountId: 'acct-1', userId: 'user-1' }, { name: 'Momentum', symbols: ['AAPL'], enabled: true })
    expect(result.id).toBe('scanner-1')
    expect(database.query.mock.calls[0][0]).toMatch(/ON CONFLICT \(id\)[\s\S]*organization_id=EXCLUDED.organization_id/)
  })

  it('soft-deletes definitions only inside the complete tenant scope', async () => {
    const database = { connected: true, query: vi.fn().mockResolvedValue({ rows: [{ id: 'alert-1' }], rowCount: 1 }) }
    const repository = createDurableWorkspaceStateRepository({ database })
    expect(await repository.deleteAlert({ tenantContext: { organizationId: 'org-1', teamWorkspaceId: 'team-1' }, accountId: 'acct-1', userId: 'user-1' }, 'alert-1')).toBe(true)
    expect(database.query.mock.calls[0][0]).toMatch(/alert_status='deleted'[\s\S]*organization_id=\$2[\s\S]*account_id=\$4 AND user_id=\$5/)
  })

  it('uses durable briefing inputs without memory reads or extra provider requests', async () => {
    const marketDataService = { getQuote: vi.fn(), getCandles: vi.fn(), getWatchlistQuotes: vi.fn() }
    const service = createWorkspaceDataService({ marketDataService })
    service.getMarketOverview = vi.fn().mockResolvedValue({ quote: { provenance: { dataStatus: 'LIVE', provider: 'fixture' } }, regime: { classification: {}, inputCoverage: {} } })
    service.getPortfolioSummary = vi.fn()
    service.listAlerts = vi.fn()
    await service.getDailyBriefing('SPY', { durablePaperState: { portfolioResult: { summary: account }, alerts: [] } })
    expect(service.getMarketOverview).toHaveBeenCalledOnce()
    expect(service.getPortfolioSummary).not.toHaveBeenCalled()
    expect(service.listAlerts).not.toHaveBeenCalled()
  })

  it('keeps durable scanner and alert definitions isolated after repository re-instantiation', async () => {
    const calls = []
    const database = { connected: true, query: vi.fn(async (sql, params) => { calls.push({ sql, params }); return { rows: sql.startsWith('SELECT') ? [{ payload: { id: params[0] === 'org-a' ? 'a' : 'b' } }] : [], rowCount: 0 } }) }
    const first = createDurableWorkspaceStateRepository({ database })
    const second = createDurableWorkspaceStateRepository({ database })
    expect((await first.listAlerts({ tenantContext: { organizationId: 'org-a' }, accountId: 'acct', userId: 'user' }))[0].id).toBe('a')
    expect((await second.listAlerts({ tenantContext: { organizationId: 'org-b' }, accountId: 'acct', userId: 'user' }))[0].id).toBe('b')
    expect(calls[0].params[0]).not.toBe(calls[1].params[0])
  })

  it('routes browser paper, journal, scanner, and alert reads to canonical authenticated Functions', async () => {
    const urls = []
    const fetchImpl = vi.fn(async (url) => {
      urls.push(url)
      return { ok: true, status: 200, json: async () => ({ ok: true, data: {} }) }
    })
    const client = createWorkspaceApiClient({ fetchImpl, accessTokenProvider: () => 'test-token' })
    await Promise.all([client.getPortfolioSummary(), client.getJournalSummary(), client.getScanners(), client.getAlerts()])
    expect(urls.filter((url) => url.includes('paper-workspace-projection'))).toHaveLength(2)
    expect(urls).toEqual(expect.arrayContaining([
      expect.stringContaining('scanner-configurations'),
      expect.stringContaining('alert-configurations'),
    ]))
    expect(fetchImpl.mock.calls.every(([, options]) => options.headers.authorization === 'Bearer test-token')).toBe(true)
  })

  it('keeps scanner and alert mutations on authenticated CSRF-bearing client requests', async () => {
    const calls = []
    const client = createWorkspaceApiClient({
      accessTokenProvider: () => 'test-token',
      fetchImpl: vi.fn(async (url, options) => {
        calls.push({ url, options })
        if (url.includes('csrf-token')) {
          return { ok: true, status: 200, json: async () => ({ ok: true, data: { token: 'signed-test-csrf', expiresAt: new Date(Date.now() + 60_000).toISOString() } }) }
        }
        return { ok: true, status: 200, json: async () => ({ ok: true, data: {} }) }
      }),
    })
    await client.createScanner({ name: 'S' })
    await client.createAlert({ label: 'A' })
    const mutationCalls = calls.filter(({ url }) => !url.includes('csrf-token'))
    expect(mutationCalls.every(({ options }) => options.method === 'POST' && options.headers['x-csrf-token'] === 'signed-test-csrf')).toBe(true)
    expect(mutationCalls.map(({ url }) => url)).toEqual([
      expect.stringContaining('scanner-configurations'),
      expect.stringContaining('alert-configurations'),
    ])
  })

  it('allows authenticated viewer reads but denies viewer definition mutations', async () => {
    const durableRepository = { persistenceMode: 'postgresql', listScanners: vi.fn().mockResolvedValue([]), saveScanner: vi.fn() }
    const options = { durableRepository, organizationMembershipRepository: membershipRepository('viewer'), repositoryFactory: () => ({ end: vi.fn() }), logger: { info: vi.fn(), error: vi.fn() }, env: {} }
    expect(response(await createScannerConfigurationsHandler(options)(apiEvent('GET', {}, { role: 'viewer' }))).statusCode).toBe(200)
    expect(response(await createScannerConfigurationsHandler(options)(apiEvent('POST', { action: 'create', scanner: {} }, { role: 'viewer' }))).statusCode).toBe(403)
    expect(durableRepository.saveScanner).not.toHaveBeenCalled()
  })

  it('requires CSRF before an owner can persist scanner definitions', async () => {
    const durableRepository = { persistenceMode: 'postgresql', listScanners: vi.fn().mockResolvedValue([]), saveScanner: vi.fn() }
    const handler = createScannerConfigurationsHandler({ durableRepository, organizationMembershipRepository: membershipRepository('owner'), repositoryFactory: () => ({ end: vi.fn() }), logger: { info: vi.fn(), error: vi.fn() }, env: {} })
    expect(response(await handler(apiEvent('POST', { action: 'create', scanner: {} }, { csrf: false }))).statusCode).toBe(403)
    expect(durableRepository.saveScanner).not.toHaveBeenCalled()
  })

  it('persists a validated alert definition through the authenticated owner boundary', async () => {
    const saved = { id: 'alert-1', symbol: 'AAPL', alertType: 'price_above' }
    const durableRepository = { persistenceMode: 'postgresql', listAlerts: vi.fn().mockResolvedValue([]), saveAlert: vi.fn().mockResolvedValue(saved) }
    const handler = createAlertConfigurationsHandler({ durableRepository, organizationMembershipRepository: membershipRepository('owner'), repositoryFactory: () => ({ end: vi.fn() }), logger: { info: vi.fn(), error: vi.fn() }, env: {} })
    const result = response(await handler(apiEvent('POST', { action: 'create', alert: { symbol: 'AAPL', assetType: 'equity', alertType: 'price_above', threshold: 100 } })))
    expect(result.statusCode).toBe(200)
    expect(result.json.data.alert).toEqual(saved)
    expect(durableRepository.saveAlert).toHaveBeenCalledOnce()
  })

  it('denies cross-organization durable configuration reads', async () => {
    const durableRepository = { persistenceMode: 'postgresql', listAlerts: vi.fn().mockResolvedValue([]) }
    const handler = createAlertConfigurationsHandler({ durableRepository, organizationMembershipRepository: membershipRepository('viewer'), repositoryFactory: () => ({ end: vi.fn() }), logger: { info: vi.fn(), error: vi.fn() }, env: {} })
    expect(response(await handler(apiEvent('GET', {}, { role: 'viewer', organizationId: 'org-other' }))).statusCode).toBe(403)
    expect(durableRepository.listAlerts).not.toHaveBeenCalled()
  })
})
