import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_INSTITUTIONAL_CHART_DRAWING_INTERACTION_PREPARED_EVENT = 'system.institutionalChartDrawingInteraction.prepared'
export const INSTITUTIONAL_CHART_DRAWING_INTERACTION_STATUSES = Object.freeze(['ready', 'caution', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Number(value ?? 0)))
}

function safeStatus(status) {
  return INSTITUTIONAL_CHART_DRAWING_INTERACTION_STATUSES.includes(status) ? status : 'caution'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

function normalizeDrawingTool(tool = {}, index = 0) {
  return {
    id: String(tool.id ?? `drawing-tool-${index + 1}`),
    type: String(tool.type ?? 'trendline').slice(0, 80),
    label: String(tool.label ?? tool.type ?? 'Trendline').slice(0, 140),
    enabled: tool.enabled !== false,
    persistent: tool.persistent !== false,
    pointsRequired: Math.max(1, Math.min(4, Number(tool.pointsRequired ?? 2))),
  }
}

function normalizeInteractionMode(mode = {}, index = 0) {
  return {
    id: String(mode.id ?? `interaction-${index + 1}`),
    type: String(mode.type ?? 'crosshair').slice(0, 80),
    enabled: mode.enabled !== false,
    synchronized: mode.synchronized !== false,
    description: String(mode.description ?? 'Chart interaction mode prepared.').slice(0, 220),
  }
}

export function normalizeInstitutionalChartDrawingInteractionRecord(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `institutional-chart-drawing-interaction-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    drawingInteractionStatus: safeStatus(input.drawingInteractionStatus ?? input.status),
    drawingInteractionScore: clampScore(input.drawingInteractionScore),
    activeTool: String(input.activeTool ?? 'select').slice(0, 80),
    drawingTools: (input.drawingTools ?? []).slice(0, 16).map(normalizeDrawingTool),
    interactionModes: (input.interactionModes ?? []).slice(0, 12).map(normalizeInteractionMode),
    zoomPanState: {
      zoomLevel: Math.max(0.1, Math.min(20, Number(input.zoomPanState?.zoomLevel ?? 1))),
      visibleRange: {
        start: input.zoomPanState?.visibleRange?.start ?? null,
        end: input.zoomPanState?.visibleRange?.end ?? null,
      },
      panLocked: input.zoomPanState?.panLocked === true,
    },
    crosshairState: {
      enabled: input.crosshairState?.enabled !== false,
      synchronized: input.crosshairState?.synchronized !== false,
      lastTimestamp: input.crosshairState?.lastTimestamp ?? null,
      lastPrice: Number.isFinite(Number(input.crosshairState?.lastPrice)) ? Number(input.crosshairState.lastPrice) : null,
    },
    persistenceSummary: {
      drawingPersistenceReady: input.persistenceSummary?.drawingPersistenceReady !== false,
      interactionPersistenceReady: input.persistenceSummary?.interactionPersistenceReady !== false,
      stateVersion: String(input.persistenceSummary?.stateVersion ?? 'chart-interaction-v1').slice(0, 80),
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

export function createInstitutionalChartDrawingInteractionRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const state = normalizeInstitutionalChartDrawingInteractionRecord(input)
      if (!database?.connected) return { ok: true, disabled: true, state }
      const result = await database.query(
        `INSERT INTO atlas_institutional_chart_drawing_interactions
          (id, organization_id, team_workspace_id, drawing_interaction_status, drawing_interaction_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET drawing_interaction_status = EXCLUDED.drawing_interaction_status, drawing_interaction_score = EXCLUDED.drawing_interaction_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [state.id, state.tenantScope.organizationId, state.tenantScope.teamWorkspaceId, state.drawingInteractionStatus, state.drawingInteractionScore, state],
      )
      return { ok: true, state: normalizeInstitutionalChartDrawingInteractionRecord(result.rows?.[0]?.payload ?? state) }
    },
    async list({ tenantContext = {}, drawingInteractionStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (drawingInteractionStatus) {
        params.push(safeStatus(drawingInteractionStatus))
        clauses.push(`drawing_interaction_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_institutional_chart_drawing_interactions
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeInstitutionalChartDrawingInteractionRecord(row.payload))
    },
  }
}

export function prepareInstitutionalChartDrawingInteraction(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.institutionalChartDrawingInteractions ?? input.institutionalChartDrawingInteraction ?? []
  const workspace = input.institutionalChartWorkspace ?? {}
  const layout = input.institutionalChartLayout ?? {}
  const firstWorkspace = workspace.institutionalChartWorkspaces?.[0] ?? workspace
  const firstLayout = layout.institutionalChartLayouts?.[0] ?? layout
  const drawingTools = firstWorkspace.drawingToolFoundation?.tools ?? ['trendline', 'horizontal-line', 'annotation']
  const toolScore = drawingTools.length >= 3 ? 90 : drawingTools.length > 0 ? 75 : 35
  const syncScore = firstLayout.timeframeSynchronizationSummary?.enabled === true ? 90 : 65
  const persistenceScore = firstWorkspace.drawingToolFoundation?.persistenceReady === false ? 60 : 90
  const score = Math.round((toolScore + syncScore + persistenceScore + 85) / 4)
  const drawingInteractionStatus = score >= 85 ? 'ready' : score >= 60 ? 'caution' : 'blocked'
  const sourceItems = Array.isArray(supplied) ? supplied : [supplied]
  const states = (sourceItems.length ? sourceItems : [normalizeInstitutionalChartDrawingInteractionRecord({
    tenantContext,
    drawingInteractionStatus,
    drawingInteractionScore: score,
    activeTool: input.activeTool,
    drawingTools: drawingTools.map((tool, index) => ({ id: `tool-${tool}`, type: tool, label: tool, pointsRequired: tool === 'annotation' ? 1 : 2, enabled: true, persistent: true, index })),
    interactionModes: [
      { id: 'crosshair-sync', type: 'crosshair', enabled: true, synchronized: true, description: 'Crosshair state is prepared for synchronized chart panes.' },
      { id: 'zoom', type: 'zoom', enabled: true, synchronized: true, description: 'Zoom state is persisted as chart interaction metadata.' },
      { id: 'pan', type: 'pan', enabled: true, synchronized: true, description: 'Pan state is persisted as chart interaction metadata.' },
    ],
    zoomPanState: input.zoomPanState,
    crosshairState: input.crosshairState,
    persistenceSummary: input.persistenceSummary,
    sourceReferences: [
      { id: 'institutional-chart-workspace', type: 'institutional-chart-workspace', eventType: workspace.eventType },
      { id: 'institutional-chart-layout', type: 'institutional-chart-layout', eventType: layout.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeInstitutionalChartDrawingInteractionRecord)
  const institutionalChartDrawingInteractionSummary = {
    total: states.length,
    ready: states.filter((item) => item.drawingInteractionStatus === 'ready').length,
    caution: states.filter((item) => item.drawingInteractionStatus === 'caution').length,
    blocked: states.filter((item) => item.drawingInteractionStatus === 'blocked').length,
    totalDrawingTools: states.reduce((sum, item) => sum + item.drawingTools.length, 0),
    totalInteractionModes: states.reduce((sum, item) => sum + item.interactionModes.length, 0),
    averageDrawingInteractionScore: states.length ? Math.round(states.reduce((sum, item) => sum + item.drawingInteractionScore, 0) / states.length) : 0,
  }
  const institutionalChartDrawingInteractionStatus = institutionalChartDrawingInteractionSummary.blocked > 0 ? 'blocked' : institutionalChartDrawingInteractionSummary.caution > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_INSTITUTIONAL_CHART_DRAWING_INTERACTION_PREPARED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    institutionalChartDrawingInteractions: states,
    institutionalChartDrawingInteractionSummary,
    institutionalChartDrawingInteractionStatus,
    chartingOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
    destructiveAutomation: false,
    summary: `Institutional chart drawing and interaction state ${institutionalChartDrawingInteractionStatus}: ${institutionalChartDrawingInteractionSummary.totalDrawingTools} tools and ${institutionalChartDrawingInteractionSummary.totalInteractionModes} interaction modes prepared.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_INSTITUTIONAL_CHART_DRAWING_INTERACTION_PREPARED_EVENT, result)
  return result
}
