import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_INSTITUTIONAL_CHART_INDICATOR_WATCHLIST_PREPARED_EVENT = 'system.institutionalChartIndicatorWatchlist.prepared'
export const INSTITUTIONAL_CHART_INDICATOR_WATCHLIST_STATUSES = Object.freeze(['ready', 'caution', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Number(value ?? 0)))
}

function safeStatus(status) {
  return INSTITUTIONAL_CHART_INDICATOR_WATCHLIST_STATUSES.includes(status) ? status : 'caution'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

function normalizeIndicatorConfiguration(indicator = {}, index = 0) {
  return {
    id: String(indicator.id ?? `indicator-config-${index + 1}`).slice(0, 100),
    indicatorId: String(indicator.indicatorId ?? indicator.id ?? 'volume').slice(0, 100),
    paneId: String(indicator.paneId ?? 'primary-price').slice(0, 100),
    enabled: indicator.enabled !== false,
    configurable: indicator.configurable !== false,
    parameters: {
      period: Number.isFinite(Number(indicator.parameters?.period)) ? Number(indicator.parameters.period) : null,
      source: String(indicator.parameters?.source ?? 'close').slice(0, 80),
      color: String(indicator.parameters?.color ?? 'system').slice(0, 40),
    },
  }
}

function normalizeWatchlistSymbol(symbol = {}, index = 0) {
  return {
    id: String(symbol.id ?? `watchlist-symbol-${index + 1}`).slice(0, 100),
    symbol: String(symbol.symbol ?? 'SPY').toUpperCase().slice(0, 24),
    assetType: String(symbol.assetType ?? 'equity').toLowerCase().slice(0, 40),
    linkedPaneIds: (symbol.linkedPaneIds ?? ['primary-price']).slice(0, 12).map((paneId) => String(paneId).slice(0, 100)),
    defaultTimeframe: String(symbol.defaultTimeframe ?? '1d').toLowerCase().slice(0, 20),
  }
}

function normalizeWatchlist(watchlist = {}, index = 0) {
  const symbols = (watchlist.symbols ?? []).slice(0, 64).map(normalizeWatchlistSymbol)
  return {
    id: String(watchlist.id ?? `chart-watchlist-${index + 1}`).slice(0, 100),
    name: String(watchlist.name ?? 'Chart Watchlist').slice(0, 140),
    description: String(watchlist.description ?? 'Tenant-scoped chart-linked symbol watchlist.').slice(0, 240),
    symbols: symbols.length ? symbols : [normalizeWatchlistSymbol()],
    linkedGroupId: String(watchlist.linkedGroupId ?? 'primary').slice(0, 100),
    persistenceReady: watchlist.persistenceReady !== false,
  }
}

export function normalizeInstitutionalChartIndicatorWatchlistRecord(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `institutional-chart-indicator-watchlist-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    indicatorWatchlistStatus: safeStatus(input.indicatorWatchlistStatus ?? input.status),
    indicatorWatchlistScore: clampScore(input.indicatorWatchlistScore),
    indicatorConfigurations: (input.indicatorConfigurations ?? []).slice(0, 24).map(normalizeIndicatorConfiguration),
    chartWatchlists: (input.chartWatchlists ?? []).slice(0, 8).map(normalizeWatchlist),
    chartLinkedSymbolSummary: {
      totalSymbols: Math.max(0, Number(input.chartLinkedSymbolSummary?.totalSymbols ?? 0)),
      linkedGroups: Math.max(0, Number(input.chartLinkedSymbolSummary?.linkedGroups ?? 0)),
      activeSymbol: String(input.chartLinkedSymbolSummary?.activeSymbol ?? 'SPY').toUpperCase().slice(0, 24),
      assetAgnostic: input.chartLinkedSymbolSummary?.assetAgnostic !== false,
    },
    persistenceSummary: {
      indicatorConfigPersistenceReady: input.persistenceSummary?.indicatorConfigPersistenceReady !== false,
      watchlistPersistenceReady: input.persistenceSummary?.watchlistPersistenceReady !== false,
      stateVersion: String(input.persistenceSummary?.stateVersion ?? 'chart-indicator-watchlist-v1').slice(0, 100),
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

export function createInstitutionalChartIndicatorWatchlistRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const state = normalizeInstitutionalChartIndicatorWatchlistRecord(input)
      if (!database?.connected) return { ok: true, disabled: true, state }
      const result = await database.query(
        `INSERT INTO atlas_institutional_chart_indicator_watchlists
          (id, organization_id, team_workspace_id, indicator_watchlist_status, indicator_watchlist_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET indicator_watchlist_status = EXCLUDED.indicator_watchlist_status, indicator_watchlist_score = EXCLUDED.indicator_watchlist_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [state.id, state.tenantScope.organizationId, state.tenantScope.teamWorkspaceId, state.indicatorWatchlistStatus, state.indicatorWatchlistScore, state],
      )
      return { ok: true, state: normalizeInstitutionalChartIndicatorWatchlistRecord(result.rows?.[0]?.payload ?? state) }
    },
    async list({ tenantContext = {}, indicatorWatchlistStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (indicatorWatchlistStatus) {
        params.push(safeStatus(indicatorWatchlistStatus))
        clauses.push(`indicator_watchlist_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_institutional_chart_indicator_watchlists
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeInstitutionalChartIndicatorWatchlistRecord(row.payload))
    },
  }
}

export function prepareInstitutionalChartIndicatorWatchlist(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.institutionalChartIndicatorWatchlists ?? input.institutionalChartIndicatorWatchlist ?? []
  const workspace = input.institutionalChartWorkspace ?? {}
  const indicatorTemplate = input.institutionalChartIndicatorTemplate ?? {}
  const advancedDrawingSync = input.institutionalChartAdvancedDrawingSync ?? {}
  const firstWorkspace = workspace.institutionalChartWorkspaces?.[0] ?? workspace
  const firstTemplate = indicatorTemplate.institutionalChartIndicatorTemplates?.[0] ?? indicatorTemplate
  const panes = firstWorkspace.chartPanes ?? []
  const indicatorDefinitions = firstTemplate.indicatorDefinitions ?? []
  const paneIds = panes.map((pane) => pane.id)
  const symbols = [...new Set(panes.map((pane) => pane.symbol ?? input.symbol ?? 'SPY'))]
  const indicatorScore = indicatorDefinitions.length >= 3 ? 90 : indicatorDefinitions.length > 0 ? 75 : 45
  const watchlistScore = symbols.length > 0 && paneIds.length > 0 ? 90 : 55
  const syncScore = advancedDrawingSync.institutionalChartAdvancedDrawingSyncStatus === 'ready' ? 90 : 75
  const score = Math.round((indicatorScore + watchlistScore + syncScore) / 3)
  const indicatorWatchlistStatus = score >= 85 ? 'ready' : score >= 60 ? 'caution' : 'blocked'
  const sourceItems = Array.isArray(supplied) ? supplied : [supplied]
  const states = (sourceItems.length ? sourceItems : [normalizeInstitutionalChartIndicatorWatchlistRecord({
    tenantContext,
    indicatorWatchlistStatus,
    indicatorWatchlistScore: score,
    indicatorConfigurations: indicatorDefinitions.map((indicator) => ({
      id: `config-${indicator.id}`,
      indicatorId: indicator.id,
      paneId: indicator.paneId,
      parameters: indicator.parameters,
    })),
    chartWatchlists: [
      {
        id: 'watchlist-primary-chart-symbols',
        name: 'Primary Chart Symbols',
        linkedGroupId: panes[0]?.linkedGroupId ?? 'primary',
        symbols: symbols.map((symbol, index) => ({
          id: `watchlist-${symbol}`,
          symbol,
          assetType: panes[index]?.assetType ?? panes[0]?.assetType ?? 'equity',
          linkedPaneIds: paneIds,
          defaultTimeframe: panes[index]?.timeframe ?? panes[0]?.timeframe ?? '1d',
        })),
      },
    ],
    chartLinkedSymbolSummary: {
      totalSymbols: symbols.length,
      linkedGroups: new Set(panes.map((pane) => pane.linkedGroupId ?? 'primary')).size,
      activeSymbol: symbols[0] ?? 'SPY',
      assetAgnostic: true,
    },
    persistenceSummary: input.persistenceSummary,
    sourceReferences: [
      { id: 'institutional-chart-workspace', type: 'institutional-chart-workspace', eventType: workspace.eventType },
      { id: 'institutional-chart-indicator-template', type: 'institutional-chart-indicator-template', eventType: indicatorTemplate.eventType },
      { id: 'institutional-chart-advanced-drawing-sync', type: 'institutional-chart-advanced-drawing-sync', eventType: advancedDrawingSync.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeInstitutionalChartIndicatorWatchlistRecord)
  const institutionalChartIndicatorWatchlistSummary = {
    total: states.length,
    ready: states.filter((item) => item.indicatorWatchlistStatus === 'ready').length,
    caution: states.filter((item) => item.indicatorWatchlistStatus === 'caution').length,
    blocked: states.filter((item) => item.indicatorWatchlistStatus === 'blocked').length,
    totalIndicatorConfigurations: states.reduce((sum, item) => sum + item.indicatorConfigurations.length, 0),
    totalWatchlists: states.reduce((sum, item) => sum + item.chartWatchlists.length, 0),
    totalLinkedSymbols: states.reduce((sum, item) => sum + item.chartLinkedSymbolSummary.totalSymbols, 0),
    averageIndicatorWatchlistScore: states.length ? Math.round(states.reduce((sum, item) => sum + item.indicatorWatchlistScore, 0) / states.length) : 0,
  }
  const institutionalChartIndicatorWatchlistStatus = institutionalChartIndicatorWatchlistSummary.blocked > 0 ? 'blocked' : institutionalChartIndicatorWatchlistSummary.caution > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_INSTITUTIONAL_CHART_INDICATOR_WATCHLIST_PREPARED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    institutionalChartIndicatorWatchlists: states,
    institutionalChartIndicatorWatchlistSummary,
    institutionalChartIndicatorWatchlistStatus,
    chartingOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
    destructiveAutomation: false,
    summary: `Institutional chart indicator and watchlist management ${institutionalChartIndicatorWatchlistStatus}: ${institutionalChartIndicatorWatchlistSummary.totalIndicatorConfigurations} configurations and ${institutionalChartIndicatorWatchlistSummary.totalLinkedSymbols} linked symbols prepared.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_INSTITUTIONAL_CHART_INDICATOR_WATCHLIST_PREPARED_EVENT, result)
  return result
}
