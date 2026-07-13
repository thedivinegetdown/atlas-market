import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_INSTITUTIONAL_CHART_INDICATOR_TEMPLATE_PREPARED_EVENT = 'system.institutionalChartIndicatorTemplate.prepared'
export const INSTITUTIONAL_CHART_INDICATOR_TEMPLATE_STATUSES = Object.freeze(['ready', 'caution', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Number(value ?? 0)))
}

function safeStatus(status) {
  return INSTITUTIONAL_CHART_INDICATOR_TEMPLATE_STATUSES.includes(status) ? status : 'caution'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

function normalizeIndicator(indicator = {}, index = 0) {
  return {
    id: String(indicator.id ?? `indicator-${index + 1}`),
    type: String(indicator.type ?? indicator.id ?? 'volume').slice(0, 80),
    label: String(indicator.label ?? indicator.type ?? 'Volume').slice(0, 140),
    paneId: String(indicator.paneId ?? 'primary-price').slice(0, 80),
    enabled: indicator.enabled !== false,
    parameters: {
      period: Number.isFinite(Number(indicator.parameters?.period)) ? Number(indicator.parameters.period) : null,
      source: indicator.parameters?.source ?? 'close',
    },
  }
}

function normalizeTemplate(template = {}, index = 0) {
  return {
    id: String(template.id ?? `chart-template-${index + 1}`),
    name: String(template.name ?? 'Chart Template').slice(0, 140),
    description: String(template.description ?? 'Reusable institutional chart template.').slice(0, 240),
    chartType: String(template.chartType ?? 'candlestick').slice(0, 80),
    defaultTimeframes: (template.defaultTimeframes ?? ['1d']).slice(0, 8).map((timeframe) => String(timeframe).toLowerCase().slice(0, 20)),
    indicatorIds: (template.indicatorIds ?? []).slice(0, 12).map((id) => String(id).slice(0, 80)),
    drawingToolIds: (template.drawingToolIds ?? []).slice(0, 12).map((id) => String(id).slice(0, 80)),
    persistenceReady: template.persistenceReady !== false,
  }
}

export function normalizeInstitutionalChartIndicatorTemplateRecord(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `institutional-chart-indicator-template-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    indicatorTemplateStatus: safeStatus(input.indicatorTemplateStatus ?? input.status),
    indicatorTemplateScore: clampScore(input.indicatorTemplateScore),
    indicatorDefinitions: (input.indicatorDefinitions ?? []).slice(0, 16).map(normalizeIndicator),
    chartTemplates: (input.chartTemplates ?? []).slice(0, 8).map(normalizeTemplate),
    templatePersistenceSummary: {
      localPersistenceReady: input.templatePersistenceSummary?.localPersistenceReady !== false,
      postgresPersistenceReady: input.templatePersistenceSummary?.postgresPersistenceReady !== false,
      templateStateVersion: String(input.templatePersistenceSummary?.templateStateVersion ?? 'chart-template-v1').slice(0, 80),
    },
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    chartingOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
    destructiveAutomation: false,
  }
}

export function createInstitutionalChartIndicatorTemplateRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const config = normalizeInstitutionalChartIndicatorTemplateRecord(input)
      if (!database?.connected) return { ok: true, disabled: true, config }
      const result = await database.query(
        `INSERT INTO atlas_institutional_chart_indicator_templates
          (id, organization_id, team_workspace_id, indicator_template_status, indicator_template_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET indicator_template_status = EXCLUDED.indicator_template_status, indicator_template_score = EXCLUDED.indicator_template_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [config.id, config.tenantScope.organizationId, config.tenantScope.teamWorkspaceId, config.indicatorTemplateStatus, config.indicatorTemplateScore, config],
      )
      return { ok: true, config: normalizeInstitutionalChartIndicatorTemplateRecord(result.rows?.[0]?.payload ?? config) }
    },
    async list({ tenantContext = {}, indicatorTemplateStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (indicatorTemplateStatus) {
        params.push(safeStatus(indicatorTemplateStatus))
        clauses.push(`indicator_template_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_institutional_chart_indicator_templates
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeInstitutionalChartIndicatorTemplateRecord(row.payload))
    },
  }
}

export function prepareInstitutionalChartIndicatorTemplate(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.institutionalChartIndicatorTemplates ?? input.institutionalChartIndicatorTemplate ?? []
  const workspace = input.institutionalChartWorkspace ?? {}
  const drawingInteraction = input.institutionalChartDrawingInteraction ?? {}
  const firstWorkspace = workspace.institutionalChartWorkspaces?.[0] ?? workspace
  const firstDrawing = drawingInteraction.institutionalChartDrawingInteractions?.[0] ?? drawingInteraction
  const indicatorNames = firstWorkspace.indicatorFramework?.indicators ?? ['volume', 'moving-average', 'vwap-ready']
  const drawingTools = firstDrawing.drawingTools ?? []
  const indicatorScore = indicatorNames.length >= 3 ? 90 : indicatorNames.length > 0 ? 75 : 35
  const templateScore = drawingTools.length > 0 ? 90 : 70
  const persistenceScore = firstWorkspace.statePersistenceSummary?.postgresPersistenceReady === false ? 60 : 90
  const score = Math.round((indicatorScore + templateScore + persistenceScore + 85) / 4)
  const indicatorTemplateStatus = score >= 85 ? 'ready' : score >= 60 ? 'caution' : 'blocked'
  const sourceItems = Array.isArray(supplied) ? supplied : [supplied]
  const configs = (sourceItems.length ? sourceItems : [normalizeInstitutionalChartIndicatorTemplateRecord({
    tenantContext,
    indicatorTemplateStatus,
    indicatorTemplateScore: score,
    indicatorDefinitions: indicatorNames.map((indicator, index) => ({
      id: `indicator-${indicator}`,
      type: indicator,
      label: indicator,
      paneId: index === 0 ? 'secondary-context' : 'primary-price',
      parameters: { period: indicator.includes('moving') ? 20 : null, source: indicator.includes('volume') ? 'volume' : 'close' },
    })),
    chartTemplates: [
      {
        id: 'template-price-action',
        name: 'Price Action Review',
        chartType: 'candlestick',
        defaultTimeframes: ['1d', '1h'],
        indicatorIds: indicatorNames.map((indicator) => `indicator-${indicator}`),
        drawingToolIds: drawingTools.map((tool) => tool.id),
      },
      {
        id: 'template-intraday-context',
        name: 'Intraday Context',
        chartType: 'line',
        defaultTimeframes: ['15m', '5m'],
        indicatorIds: indicatorNames.map((indicator) => `indicator-${indicator}`),
        drawingToolIds: drawingTools.map((tool) => tool.id),
      },
    ],
    templatePersistenceSummary: input.templatePersistenceSummary,
    sourceReferences: [
      { id: 'institutional-chart-workspace', type: 'institutional-chart-workspace', eventType: workspace.eventType },
      { id: 'institutional-chart-drawing-interaction', type: 'institutional-chart-drawing-interaction', eventType: drawingInteraction.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeInstitutionalChartIndicatorTemplateRecord)
  const institutionalChartIndicatorTemplateSummary = {
    total: configs.length,
    ready: configs.filter((item) => item.indicatorTemplateStatus === 'ready').length,
    caution: configs.filter((item) => item.indicatorTemplateStatus === 'caution').length,
    blocked: configs.filter((item) => item.indicatorTemplateStatus === 'blocked').length,
    totalIndicators: configs.reduce((sum, item) => sum + item.indicatorDefinitions.length, 0),
    totalTemplates: configs.reduce((sum, item) => sum + item.chartTemplates.length, 0),
    averageIndicatorTemplateScore: configs.length ? Math.round(configs.reduce((sum, item) => sum + item.indicatorTemplateScore, 0) / configs.length) : 0,
  }
  const institutionalChartIndicatorTemplateStatus = institutionalChartIndicatorTemplateSummary.blocked > 0 ? 'blocked' : institutionalChartIndicatorTemplateSummary.caution > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_INSTITUTIONAL_CHART_INDICATOR_TEMPLATE_PREPARED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    institutionalChartIndicatorTemplates: configs,
    institutionalChartIndicatorTemplateSummary,
    institutionalChartIndicatorTemplateStatus,
    chartingOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
    destructiveAutomation: false,
    summary: `Institutional chart indicator and template framework ${institutionalChartIndicatorTemplateStatus}: ${institutionalChartIndicatorTemplateSummary.totalIndicators} indicators and ${institutionalChartIndicatorTemplateSummary.totalTemplates} templates prepared.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_INSTITUTIONAL_CHART_INDICATOR_TEMPLATE_PREPARED_EVENT, result)
  return result
}
