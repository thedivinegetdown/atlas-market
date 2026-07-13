import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { createInstitutionalChartWorkspaceRepository, prepareInstitutionalChartWorkspace, SYSTEM_INSTITUTIONAL_CHART_WORKSPACE_PREPARED_EVENT } from '../lib/system/institutionalChartWorkspaceEngine.js'
import { createInstitutionalChartLayoutRepository, synchronizeInstitutionalChartLayout, SYSTEM_INSTITUTIONAL_CHART_LAYOUT_SYNCHRONIZED_EVENT } from '../lib/system/institutionalChartLayoutEngine.js'
import { createInstitutionalChartWorkspacesHandler } from '../netlify/functions/institutional-chart-workspaces.js'
import { createInstitutionalChartLayoutsHandler } from '../netlify/functions/institutional-chart-layouts.js'

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
      'x-request-id': 'req-phase63ab',
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
  const historicalReplay = {
    eventType: 'market.replay.stepPrepared',
    normalizedHistoricalCandles: Array.from({ length: 24 }, (_, index) => ({
      symbol: 'SPY',
      close: 500 + index,
      timestamp: `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    })),
  }
  const institutionalChartWorkspace = prepareInstitutionalChartWorkspace({
    tenantContext,
    symbol: 'SPY',
    assetType: 'etf',
    marketDataAdapterHealth: { eventType: 'marketData.adapter.health', status: 'healthy' },
    historicalReplay,
    workspacePersistence: { eventType: 'workspace.persistence.prepared', persistenceStatus: 'ready' },
  }, { emitEvent: false })
  const institutionalChartLayout = synchronizeInstitutionalChartLayout({
    tenantContext,
    institutionalChartWorkspace,
  }, { emitEvent: false })
  return { historicalReplay, institutionalChartWorkspace, institutionalChartLayout }
}

describe('Phase 63A institutional chart workspace architecture', () => {
  it('adds idempotent chart workspace migrations and parameterized repository access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_institutional_chart_workspaces')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_institutional_chart_layouts')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createInstitutionalChartWorkspaceRepository({ database: { connected: true, query } })
    await repository.create({ id: 'chart-workspace-1', tenantContext, workspaceStatus: 'ready', workspaceScore: 92 })
    await repository.list({ tenantContext, workspaceStatus: 'ready' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('prepares chart workspace architecture without trading execution paths', () => {
    const result = upstream().institutionalChartWorkspace
    expect(result.eventType).toBe(SYSTEM_INSTITUTIONAL_CHART_WORKSPACE_PREPARED_EVENT)
    expect(result.institutionalChartWorkspaces[0].chartPanes.length).toBeGreaterThan(1)
    expect(result.institutionalChartWorkspaces[0].drawingToolFoundation.enabled).toBe(true)
    expect(result.institutionalChartWorkspaces[0].indicatorFramework.enabled).toBe(true)
    expect(result.liveOrders).toBe(false)
    expect(result.brokerExecution).toBe(false)
    expect(result.automaticTrading).toBe(false)
  })

  it('serves chart workspace APIs to trading desk roles only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('analyst'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createInstitutionalChartWorkspacesHandler(options)(authEvent('GET')))
    const create = parseResponse(await createInstitutionalChartWorkspacesHandler(options)(authEvent('POST', { workspace: { id: 'chart-workspace-1' } })))
    const denied = parseResponse(await createInstitutionalChartWorkspacesHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.institutionalChartWorkspace.chartingOnly).toBe(true)
    expect(create.json.data.workspace.liveOrders).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 63B institutional multi-chart layout synchronization', () => {
  it('prepares multi-chart layout and timeframe synchronization safely', async () => {
    const result = upstream().institutionalChartLayout
    expect(result.eventType).toBe(SYSTEM_INSTITUTIONAL_CHART_LAYOUT_SYNCHRONIZED_EVENT)
    expect(result.institutionalChartLayouts[0].layoutCells.length).toBeGreaterThan(1)
    expect(result.institutionalChartLayouts[0].synchronizationGroups.length).toBeGreaterThan(0)
    expect(result.institutionalChartLayouts[0].timeframeSynchronizationSummary.enabled).toBe(true)
    expect(result.liveOrders).toBe(false)
    expect(result.brokerExecution).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createInstitutionalChartLayoutRepository({ database: { connected: true, query } })
    await repository.create({ id: 'chart-layout-1', tenantContext, layoutStatus: 'ready', layoutScore: 92 })
    await repository.list({ tenantContext, layoutStatus: 'ready' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves chart layout APIs to trading desk roles only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('admin'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createInstitutionalChartLayoutsHandler(options)(authEvent('GET', {}, 'admin')))
    const create = parseResponse(await createInstitutionalChartLayoutsHandler(options)(authEvent('POST', { layout: { id: 'chart-layout-1' } }, 'admin')))
    const denied = parseResponse(await createInstitutionalChartLayoutsHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.institutionalChartLayout.chartingOnly).toBe(true)
    expect(create.json.data.layout.automaticTrading).toBe(false)
    expect(denied.statusCode).toBe(403)
  })

  it('keeps charting API responses free of sensitive material and execution flags', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('analyst'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const response = parseResponse(await createInstitutionalChartLayoutsHandler(options)(authEvent('GET')))
    expect(response.statusCode).toBe(200)
    expect(JSON.stringify(response.json)).not.toMatch(/"tokenHash"|"ipAddress"|"deviceFingerprint"|"secret"/)
    expect(response.json.data.liveOrders).toBe(false)
    expect(response.json.data.brokerExecution).toBe(false)
  })
})
