import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { prepareInstitutionalChartWorkspace } from '../lib/system/institutionalChartWorkspaceEngine.js'
import { synchronizeInstitutionalChartLayout } from '../lib/system/institutionalChartLayoutEngine.js'
import { createInstitutionalChartDrawingInteractionRepository, prepareInstitutionalChartDrawingInteraction, SYSTEM_INSTITUTIONAL_CHART_DRAWING_INTERACTION_PREPARED_EVENT } from '../lib/system/institutionalChartDrawingInteractionEngine.js'
import { createInstitutionalChartIndicatorTemplateRepository, prepareInstitutionalChartIndicatorTemplate, SYSTEM_INSTITUTIONAL_CHART_INDICATOR_TEMPLATE_PREPARED_EVENT } from '../lib/system/institutionalChartIndicatorTemplateEngine.js'
import { createInstitutionalChartDrawingInteractionsHandler } from '../netlify/functions/institutional-chart-drawing-interactions.js'
import { createInstitutionalChartIndicatorTemplatesHandler } from '../netlify/functions/institutional-chart-indicator-templates.js'

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
      'x-request-id': 'req-phase64ab',
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
  const institutionalChartDrawingInteraction = prepareInstitutionalChartDrawingInteraction({
    tenantContext,
    institutionalChartWorkspace,
    institutionalChartLayout,
  }, { emitEvent: false })
  const institutionalChartIndicatorTemplate = prepareInstitutionalChartIndicatorTemplate({
    tenantContext,
    institutionalChartWorkspace,
    institutionalChartDrawingInteraction,
  }, { emitEvent: false })
  return {
    institutionalChartWorkspace,
    institutionalChartLayout,
    institutionalChartDrawingInteraction,
    institutionalChartIndicatorTemplate,
  }
}

describe('Phase 64A institutional chart drawing and interaction foundation', () => {
  it('adds idempotent drawing interaction migration and parameterized repository access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_institutional_chart_drawing_interactions')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_institutional_chart_indicator_templates')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createInstitutionalChartDrawingInteractionRepository({ database: { connected: true, query } })
    await repository.create({ id: 'drawing-state-1', tenantContext, drawingInteractionStatus: 'ready', drawingInteractionScore: 92 })
    await repository.list({ tenantContext, drawingInteractionStatus: 'ready' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('prepares drawing tools, zoom, pan, and crosshair state without trading execution', () => {
    const result = upstream().institutionalChartDrawingInteraction
    expect(result.eventType).toBe(SYSTEM_INSTITUTIONAL_CHART_DRAWING_INTERACTION_PREPARED_EVENT)
    expect(result.institutionalChartDrawingInteractions[0].drawingTools.length).toBeGreaterThan(2)
    expect(result.institutionalChartDrawingInteractions[0].interactionModes.map((mode) => mode.type)).toContain('crosshair')
    expect(result.liveOrders).toBe(false)
    expect(result.brokerExecution).toBe(false)
    expect(result.automaticTrading).toBe(false)
  })

  it('serves drawing interaction APIs to trading desk roles only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('analyst'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createInstitutionalChartDrawingInteractionsHandler(options)(authEvent('GET')))
    const create = parseResponse(await createInstitutionalChartDrawingInteractionsHandler(options)(authEvent('POST', { state: { id: 'drawing-state-1' } })))
    const denied = parseResponse(await createInstitutionalChartDrawingInteractionsHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.institutionalChartDrawingInteraction.chartingOnly).toBe(true)
    expect(create.json.data.state.automaticTrading).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 64B institutional chart indicator framework and templates', () => {
  it('prepares indicators, templates, and chart state persistence safely', async () => {
    const result = upstream().institutionalChartIndicatorTemplate
    expect(result.eventType).toBe(SYSTEM_INSTITUTIONAL_CHART_INDICATOR_TEMPLATE_PREPARED_EVENT)
    expect(result.institutionalChartIndicatorTemplates[0].indicatorDefinitions.length).toBeGreaterThan(2)
    expect(result.institutionalChartIndicatorTemplates[0].chartTemplates.length).toBeGreaterThan(1)
    expect(result.liveOrders).toBe(false)
    expect(result.brokerExecution).toBe(false)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createInstitutionalChartIndicatorTemplateRepository({ database: { connected: true, query } })
    await repository.create({ id: 'indicator-template-1', tenantContext, indicatorTemplateStatus: 'ready', indicatorTemplateScore: 92 })
    await repository.list({ tenantContext, indicatorTemplateStatus: 'ready' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves indicator template APIs to trading desk roles only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('admin'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createInstitutionalChartIndicatorTemplatesHandler(options)(authEvent('GET', {}, 'admin')))
    const create = parseResponse(await createInstitutionalChartIndicatorTemplatesHandler(options)(authEvent('POST', { config: { id: 'indicator-template-1' } }, 'admin')))
    const denied = parseResponse(await createInstitutionalChartIndicatorTemplatesHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.institutionalChartIndicatorTemplate.chartingOnly).toBe(true)
    expect(create.json.data.config.automaticTrading).toBe(false)
    expect(denied.statusCode).toBe(403)
  })

  it('keeps chart indicator template API responses free of sensitive material and execution flags', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('analyst'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const response = parseResponse(await createInstitutionalChartIndicatorTemplatesHandler(options)(authEvent('GET')))
    expect(response.statusCode).toBe(200)
    expect(JSON.stringify(response.json)).not.toMatch(/"tokenHash"|"ipAddress"|"deviceFingerprint"|"secret"/)
    expect(response.json.data.liveOrders).toBe(false)
    expect(response.json.data.brokerExecution).toBe(false)
  })
})
