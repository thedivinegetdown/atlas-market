import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_INSTITUTIONAL_CHART_WORKSPACE_PREPARED_EVENT = 'system.institutionalChartWorkspace.prepared'
export const INSTITUTIONAL_CHART_WORKSPACE_STATUSES = Object.freeze(['ready', 'caution', 'blocked'])
export const DEFAULT_CHART_TIMEFRAMES = Object.freeze(['1m', '5m', '15m', '1h', '1d', '1w'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Number(value ?? 0)))
}

function safeStatus(status) {
  return INSTITUTIONAL_CHART_WORKSPACE_STATUSES.includes(status) ? status : 'caution'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

function normalizeChartPane(pane = {}, index = 0) {
  return {
    id: String(pane.id ?? `chart-pane-${index + 1}`),
    symbol: String(pane.symbol ?? 'SPY').toUpperCase().slice(0, 24),
    assetType: String(pane.assetType ?? 'equity').toLowerCase().slice(0, 40),
    timeframe: String(pane.timeframe ?? '1d').toLowerCase().slice(0, 20),
    chartType: String(pane.chartType ?? 'candlestick').toLowerCase().slice(0, 40),
    indicators: (pane.indicators ?? ['volume']).slice(0, 8).map((indicator) => String(indicator).slice(0, 80)),
    drawingToolMode: String(pane.drawingToolMode ?? 'select').slice(0, 60),
    linkedGroupId: pane.linkedGroupId ?? 'primary',
  }
}

export function normalizeInstitutionalChartWorkspaceRecord(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  const panes = (input.chartPanes ?? input.panes ?? []).slice(0, 8).map(normalizeChartPane)
  return {
    id: String(input.id ?? `institutional-chart-workspace-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    workspaceStatus: safeStatus(input.workspaceStatus ?? input.status),
    workspaceScore: clampScore(input.workspaceScore),
    workspaceName: String(input.workspaceName ?? 'Institutional Chart Workspace').slice(0, 140),
    chartPanes: panes.length ? panes : [normalizeChartPane()],
    supportedTimeframes: (input.supportedTimeframes ?? DEFAULT_CHART_TIMEFRAMES).slice(0, 12).map((timeframe) => String(timeframe).toLowerCase().slice(0, 20)),
    drawingToolFoundation: {
      enabled: input.drawingToolFoundation?.enabled !== false,
      tools: (input.drawingToolFoundation?.tools ?? ['trendline', 'horizontal-line', 'annotation']).slice(0, 12).map((tool) => String(tool).slice(0, 80)),
      persistenceReady: input.drawingToolFoundation?.persistenceReady !== false,
    },
    indicatorFramework: {
      enabled: input.indicatorFramework?.enabled !== false,
      indicators: (input.indicatorFramework?.indicators ?? ['volume', 'moving-average', 'vwap-ready']).slice(0, 12).map((indicator) => String(indicator).slice(0, 80)),
      customIndicatorSupport: false,
    },
    statePersistenceSummary: {
      localPersistenceReady: input.statePersistenceSummary?.localPersistenceReady !== false,
      postgresPersistenceReady: input.statePersistenceSummary?.postgresPersistenceReady !== false,
      chartStateVersion: String(input.statePersistenceSummary?.chartStateVersion ?? 'chart-state-v1').slice(0, 80),
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

export function createInstitutionalChartWorkspaceRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const workspace = normalizeInstitutionalChartWorkspaceRecord(input)
      if (!database?.connected) return { ok: true, disabled: true, workspace }
      const result = await database.query(
        `INSERT INTO atlas_institutional_chart_workspaces
          (id, organization_id, team_workspace_id, workspace_status, workspace_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET workspace_status = EXCLUDED.workspace_status, workspace_score = EXCLUDED.workspace_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [workspace.id, workspace.tenantScope.organizationId, workspace.tenantScope.teamWorkspaceId, workspace.workspaceStatus, workspace.workspaceScore, workspace],
      )
      return { ok: true, workspace: normalizeInstitutionalChartWorkspaceRecord(result.rows?.[0]?.payload ?? workspace) }
    },
    async list({ tenantContext = {}, workspaceStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (workspaceStatus) {
        params.push(safeStatus(workspaceStatus))
        clauses.push(`workspace_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_institutional_chart_workspaces
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeInstitutionalChartWorkspaceRecord(row.payload))
    },
  }
}

export function prepareInstitutionalChartWorkspace(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.institutionalChartWorkspaces ?? input.institutionalChartWorkspace ?? []
  const marketDataAdapterHealth = input.marketDataAdapterHealth ?? {}
  const historicalReplay = input.historicalReplay ?? {}
  const workspacePersistence = input.workspacePersistence ?? {}
  const normalizedCandles = historicalReplay.normalizedHistoricalCandles ?? input.normalizedCandles ?? []
  const marketDataScore = marketDataAdapterHealth.status === 'healthy' || marketDataAdapterHealth.health?.status === 'healthy' ? 90 : 70
  const candleScore = normalizedCandles.length >= 20 ? 90 : normalizedCandles.length > 0 ? 75 : 45
  const persistenceScore = workspacePersistence.persistenceStatus === 'ready' || workspacePersistence.persistenceStatus === 'prepared' ? 90 : 75
  const chartArchitectureScore = Math.round((marketDataScore + candleScore + persistenceScore + 85) / 4)
  const workspaceStatus = chartArchitectureScore >= 85 ? 'ready' : chartArchitectureScore >= 60 ? 'caution' : 'blocked'
  const sourceItems = Array.isArray(supplied) ? supplied : [supplied]
  const workspaces = (sourceItems.length ? sourceItems : [normalizeInstitutionalChartWorkspaceRecord({
    tenantContext,
    workspaceStatus,
    workspaceScore: chartArchitectureScore,
    workspaceName: input.workspaceName,
    chartPanes: input.chartPanes ?? [
      { id: 'primary-price', symbol: input.symbol ?? 'SPY', assetType: input.assetType ?? 'etf', timeframe: '1d', chartType: 'candlestick', indicators: ['volume', 'moving-average'], linkedGroupId: 'primary' },
      { id: 'secondary-context', symbol: input.symbol ?? 'SPY', assetType: input.assetType ?? 'etf', timeframe: '1h', chartType: 'line', indicators: ['volume'], linkedGroupId: 'primary' },
    ],
    sourceReferences: [
      { id: 'market-data-adapter', type: 'market-data-adapter', eventType: marketDataAdapterHealth.eventType },
      { id: 'historical-replay', type: 'historical-replay', eventType: historicalReplay.eventType },
      { id: 'workspace-persistence', type: 'workspace-persistence', eventType: workspacePersistence.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeInstitutionalChartWorkspaceRecord)
  const institutionalChartWorkspaceSummary = {
    total: workspaces.length,
    ready: workspaces.filter((item) => item.workspaceStatus === 'ready').length,
    caution: workspaces.filter((item) => item.workspaceStatus === 'caution').length,
    blocked: workspaces.filter((item) => item.workspaceStatus === 'blocked').length,
    totalChartPanes: workspaces.reduce((sum, item) => sum + item.chartPanes.length, 0),
    averageWorkspaceScore: workspaces.length ? Math.round(workspaces.reduce((sum, item) => sum + item.workspaceScore, 0) / workspaces.length) : 0,
  }
  const institutionalChartWorkspaceStatus = institutionalChartWorkspaceSummary.blocked > 0 ? 'blocked' : institutionalChartWorkspaceSummary.caution > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_INSTITUTIONAL_CHART_WORKSPACE_PREPARED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    institutionalChartWorkspaces: workspaces,
    institutionalChartWorkspaceSummary,
    institutionalChartWorkspaceStatus,
    chartingOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
    destructiveAutomation: false,
    summary: `Institutional chart workspace ${institutionalChartWorkspaceStatus}: ${institutionalChartWorkspaceSummary.totalChartPanes} chart panes prepared.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_INSTITUTIONAL_CHART_WORKSPACE_PREPARED_EVENT, result)
  return result
}
