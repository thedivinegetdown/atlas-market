import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { prepareInstitutionalChartWorkspace } from '../lib/system/institutionalChartWorkspaceEngine.js'
import { synchronizeInstitutionalChartLayout } from '../lib/system/institutionalChartLayoutEngine.js'
import { prepareInstitutionalChartDrawingInteraction } from '../lib/system/institutionalChartDrawingInteractionEngine.js'
import { prepareInstitutionalChartIndicatorTemplate } from '../lib/system/institutionalChartIndicatorTemplateEngine.js'
import { createInstitutionalChartAdvancedDrawingSyncRepository, prepareInstitutionalChartAdvancedDrawingSync, SYSTEM_INSTITUTIONAL_CHART_ADVANCED_DRAWING_SYNC_PREPARED_EVENT } from '../lib/system/institutionalChartAdvancedDrawingSyncEngine.js'
import { createInstitutionalChartIndicatorWatchlistRepository, prepareInstitutionalChartIndicatorWatchlist, SYSTEM_INSTITUTIONAL_CHART_INDICATOR_WATCHLIST_PREPARED_EVENT } from '../lib/system/institutionalChartIndicatorWatchlistEngine.js'
import { createInstitutionalChartAdvancedDrawingSyncHandler } from '../netlify/functions/institutional-chart-advanced-drawing-sync.js'
import { createInstitutionalChartIndicatorWatchlistsHandler } from '../netlify/functions/institutional-chart-indicator-watchlists.js'

const userId = 'local-development:local-operator'
const tenantContext = { organizationId: 'org-atlas-local', teamWorkspaceId: null, userId, role: 'analyst' }

function parseResponse(response) {
  return { ...response, json: response.body ? JSON.parse(response.body) : null }
}

function authEvent(method = 'GET', body = {}, role = 'analyst') {
  return {
    httpMethod: method,
    headers: {
      authorization: 'Bearer dev-token',
      'content-type': 'application/json',
      'x-csrf-token': 'csrf-ready',
      'x-request-id': 'req-phase65ab',
      'x-atlas-dev-role': role,
      'x-atlas-dev-subject': 'local-operator',
    },
    queryStringParameters: { organizationId: 'org-atlas-local', limit: '25' },
    body: method === 'POST' ? JSON.stringify(body) : '',
  }
}

function repositoryFactory() {
  return { connected: false, getStore: vi.fn(() => ({ listScoped: vi.fn(async () => []) })), end: vi.fn(async () => {}) }
}

function membershipRepository(role = 'analyst') {
  return { getMembership: vi.fn(async () => ({ id: `membership-${role}`, organizationId: 'org-atlas-local', userId, role, status: 'active' })) }
}

function upstream() {
  const institutionalChartWorkspace = prepareInstitutionalChartWorkspace({
    tenantContext,
    marketDataAdapterHealth: { eventType: 'marketData.adapter.health', status: 'healthy' },
    historicalReplay: { eventType: 'market.replay.stepPrepared', normalizedHistoricalCandles: Array.from({ length: 24 }, (_, index) => ({ close: 500 + index, timestamp: `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z` })) },
    workspacePersistence: { eventType: 'workspace.persistence.prepared', persistenceStatus: 'ready' },
  }, { emitEvent: false })
  const institutionalChartLayout = synchronizeInstitutionalChartLayout({ tenantContext, institutionalChartWorkspace }, { emitEvent: false })
  const institutionalChartDrawingInteraction = prepareInstitutionalChartDrawingInteraction({ tenantContext, institutionalChartWorkspace, institutionalChartLayout }, { emitEvent: false })
  const institutionalChartIndicatorTemplate = prepareInstitutionalChartIndicatorTemplate({ tenantContext, institutionalChartWorkspace, institutionalChartDrawingInteraction }, { emitEvent: false })
  const institutionalChartAdvancedDrawingSync = prepareInstitutionalChartAdvancedDrawingSync({
    tenantContext,
    institutionalChartDrawingInteraction,
    institutionalChartLayout,
  }, { emitEvent: false })
  const institutionalChartIndicatorWatchlist = prepareInstitutionalChartIndicatorWatchlist({
    tenantContext,
    institutionalChartWorkspace,
    institutionalChartIndicatorTemplate,
    institutionalChartAdvancedDrawingSync,
  }, { emitEvent: false })
  return {
    institutionalChartWorkspace,
    institutionalChartLayout,
    institutionalChartDrawingInteraction,
    institutionalChartIndicatorTemplate,
    institutionalChartAdvancedDrawingSync,
    institutionalChartIndicatorWatchlist,
  }
}

describe('Phase 65A institutional chart advanced drawing and synchronization', () => {
  it('adds idempotent advanced drawing sync migration and parameterized repository access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_institutional_chart_advanced_drawing_sync')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_institutional_chart_indicator_watchlists')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createInstitutionalChartAdvancedDrawingSyncRepository({ database: { connected: true, query } })
    await repository.create({ id: 'advanced-drawing-sync-1', tenantContext, advancedDrawingSyncStatus: 'ready', advancedDrawingSyncScore: 92 })
    await repository.list({ tenantContext, advancedDrawingSyncStatus: 'ready' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('prepares trend lines, rays, Fibonacci, channels, annotations, and sync enhancements without execution', () => {
    const result = upstream().institutionalChartAdvancedDrawingSync
    const toolTypes = result.institutionalChartAdvancedDrawingSyncRecords[0].advancedDrawingTools.map((tool) => tool.type)
    expect(result.eventType).toBe(SYSTEM_INSTITUTIONAL_CHART_ADVANCED_DRAWING_SYNC_PREPARED_EVENT)
    expect(toolTypes).toEqual(expect.arrayContaining(['trendline', 'ray', 'fibonacci-retracement', 'parallel-channel', 'annotation']))
    expect(result.institutionalChartAdvancedDrawingSyncRecords[0].synchronizationEnhancements.length).toBeGreaterThan(2)
    expect(result.liveOrders).toBe(false)
    expect(result.brokerExecution).toBe(false)
    expect(result.automaticTrading).toBe(false)
  })

  it('serves advanced drawing sync APIs to trading desk roles only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('analyst'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createInstitutionalChartAdvancedDrawingSyncHandler(options)(authEvent('GET')))
    const create = parseResponse(await createInstitutionalChartAdvancedDrawingSyncHandler(options)(authEvent('POST', { state: { id: 'advanced-drawing-sync-1' } })))
    const denied = parseResponse(await createInstitutionalChartAdvancedDrawingSyncHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.institutionalChartAdvancedDrawingSync.chartingOnly).toBe(true)
    expect(create.json.data.state.automaticTrading).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 65B institutional chart indicator management and watchlists', () => {
  it('prepares indicator management and chart-linked watchlists safely', async () => {
    const result = upstream().institutionalChartIndicatorWatchlist
    expect(result.eventType).toBe(SYSTEM_INSTITUTIONAL_CHART_INDICATOR_WATCHLIST_PREPARED_EVENT)
    expect(result.institutionalChartIndicatorWatchlists[0].indicatorConfigurations.length).toBeGreaterThan(2)
    expect(result.institutionalChartIndicatorWatchlists[0].chartWatchlists[0].symbols.length).toBeGreaterThan(0)
    expect(result.liveOrders).toBe(false)
    expect(result.brokerExecution).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createInstitutionalChartIndicatorWatchlistRepository({ database: { connected: true, query } })
    await repository.create({ id: 'indicator-watchlist-1', tenantContext, indicatorWatchlistStatus: 'ready', indicatorWatchlistScore: 92 })
    await repository.list({ tenantContext, indicatorWatchlistStatus: 'ready' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves indicator watchlist APIs to trading desk roles only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('admin'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createInstitutionalChartIndicatorWatchlistsHandler(options)(authEvent('GET', {}, 'admin')))
    const create = parseResponse(await createInstitutionalChartIndicatorWatchlistsHandler(options)(authEvent('POST', { state: { id: 'indicator-watchlist-1' } }, 'admin')))
    const denied = parseResponse(await createInstitutionalChartIndicatorWatchlistsHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.institutionalChartIndicatorWatchlist.chartingOnly).toBe(true)
    expect(create.json.data.state.automaticTrading).toBe(false)
    expect(denied.statusCode).toBe(403)
  })

  it('keeps chart management API responses free of sensitive material and execution flags', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('analyst'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const response = parseResponse(await createInstitutionalChartIndicatorWatchlistsHandler(options)(authEvent('GET')))
    expect(response.statusCode).toBe(200)
    expect(JSON.stringify(response.json)).not.toMatch(/"tokenHash"|"ipAddress"|"deviceFingerprint"|"secret"/)
    expect(response.json.data.liveOrders).toBe(false)
    expect(response.json.data.brokerExecution).toBe(false)
  })
})
