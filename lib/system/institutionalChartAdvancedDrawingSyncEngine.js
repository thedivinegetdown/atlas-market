import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_INSTITUTIONAL_CHART_ADVANCED_DRAWING_SYNC_PREPARED_EVENT = 'system.institutionalChartAdvancedDrawingSync.prepared'
export const INSTITUTIONAL_CHART_ADVANCED_DRAWING_SYNC_STATUSES = Object.freeze(['ready', 'caution', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Number(value ?? 0)))
}

function safeStatus(status) {
  return INSTITUTIONAL_CHART_ADVANCED_DRAWING_SYNC_STATUSES.includes(status) ? status : 'caution'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

function normalizeAdvancedDrawingTool(tool = {}, index = 0) {
  return {
    id: String(tool.id ?? `advanced-drawing-tool-${index + 1}`).slice(0, 100),
    type: String(tool.type ?? 'trendline').toLowerCase().slice(0, 80),
    label: String(tool.label ?? tool.type ?? 'Trendline').slice(0, 140),
    enabled: tool.enabled !== false,
    persistent: tool.persistent !== false,
    pointsRequired: Math.max(1, Math.min(6, Number(tool.pointsRequired ?? 2))),
    syncAcrossPanes: tool.syncAcrossPanes !== false,
    styleEditable: tool.styleEditable !== false,
  }
}

function normalizeSyncEnhancement(enhancement = {}, index = 0) {
  return {
    id: String(enhancement.id ?? `chart-sync-enhancement-${index + 1}`).slice(0, 100),
    type: String(enhancement.type ?? 'symbol-link').toLowerCase().slice(0, 80),
    enabled: enhancement.enabled !== false,
    scope: String(enhancement.scope ?? 'linked-group').slice(0, 80),
    description: String(enhancement.description ?? 'Institutional chart synchronization enhancement.').slice(0, 240),
  }
}

export function normalizeInstitutionalChartAdvancedDrawingSyncRecord(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `institutional-chart-advanced-drawing-sync-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    advancedDrawingSyncStatus: safeStatus(input.advancedDrawingSyncStatus ?? input.status),
    advancedDrawingSyncScore: clampScore(input.advancedDrawingSyncScore),
    advancedDrawingTools: (input.advancedDrawingTools ?? []).slice(0, 24).map(normalizeAdvancedDrawingTool),
    synchronizationEnhancements: (input.synchronizationEnhancements ?? []).slice(0, 12).map(normalizeSyncEnhancement),
    drawingLayerState: {
      activeLayerId: String(input.drawingLayerState?.activeLayerId ?? 'primary-drawing-layer').slice(0, 100),
      layerPersistenceReady: input.drawingLayerState?.layerPersistenceReady !== false,
      lockedLayerCount: Math.max(0, Number(input.drawingLayerState?.lockedLayerCount ?? 0)),
      visibleLayerCount: Math.max(0, Number(input.drawingLayerState?.visibleLayerCount ?? 1)),
    },
    synchronizationState: {
      symbolSyncReady: input.synchronizationState?.symbolSyncReady !== false,
      timeframeSyncReady: input.synchronizationState?.timeframeSyncReady !== false,
      drawingSyncReady: input.synchronizationState?.drawingSyncReady !== false,
      crosshairSyncReady: input.synchronizationState?.crosshairSyncReady !== false,
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

export function createInstitutionalChartAdvancedDrawingSyncRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const state = normalizeInstitutionalChartAdvancedDrawingSyncRecord(input)
      if (!database?.connected) return { ok: true, disabled: true, state }
      const result = await database.query(
        `INSERT INTO atlas_institutional_chart_advanced_drawing_sync
          (id, organization_id, team_workspace_id, advanced_drawing_sync_status, advanced_drawing_sync_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET advanced_drawing_sync_status = EXCLUDED.advanced_drawing_sync_status, advanced_drawing_sync_score = EXCLUDED.advanced_drawing_sync_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [state.id, state.tenantScope.organizationId, state.tenantScope.teamWorkspaceId, state.advancedDrawingSyncStatus, state.advancedDrawingSyncScore, state],
      )
      return { ok: true, state: normalizeInstitutionalChartAdvancedDrawingSyncRecord(result.rows?.[0]?.payload ?? state) }
    },
    async list({ tenantContext = {}, advancedDrawingSyncStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (advancedDrawingSyncStatus) {
        params.push(safeStatus(advancedDrawingSyncStatus))
        clauses.push(`advanced_drawing_sync_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_institutional_chart_advanced_drawing_sync
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeInstitutionalChartAdvancedDrawingSyncRecord(row.payload))
    },
  }
}

export function prepareInstitutionalChartAdvancedDrawingSync(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.institutionalChartAdvancedDrawingSyncRecords ?? input.institutionalChartAdvancedDrawingSync ?? []
  const drawingInteraction = input.institutionalChartDrawingInteraction ?? {}
  const layout = input.institutionalChartLayout ?? {}
  const firstDrawing = drawingInteraction.institutionalChartDrawingInteractions?.[0] ?? drawingInteraction
  const firstLayout = layout.institutionalChartLayouts?.[0] ?? layout
  const baseToolTypes = new Set((firstDrawing.drawingTools ?? []).map((tool) => tool.type))
  const advancedToolTypes = ['trendline', 'ray', 'fibonacci-retracement', 'parallel-channel', 'annotation']
  const coveredTools = advancedToolTypes.filter((tool) => baseToolTypes.has(tool) || ['ray', 'fibonacci-retracement', 'parallel-channel'].includes(tool)).length
  const syncGroupCount = firstLayout.synchronizationGroups?.length ?? 0
  const toolScore = coveredTools >= advancedToolTypes.length ? 92 : coveredTools >= 3 ? 82 : 55
  const syncScore = syncGroupCount > 0 && firstDrawing.crosshairState?.synchronized !== false ? 90 : 65
  const score = Math.round((toolScore + syncScore + 88) / 3)
  const advancedDrawingSyncStatus = score >= 85 ? 'ready' : score >= 60 ? 'caution' : 'blocked'
  const sourceItems = Array.isArray(supplied) ? supplied : [supplied]
  const states = (sourceItems.length ? sourceItems : [normalizeInstitutionalChartAdvancedDrawingSyncRecord({
    tenantContext,
    advancedDrawingSyncStatus,
    advancedDrawingSyncScore: score,
    advancedDrawingTools: [
      { id: 'advanced-trendline', type: 'trendline', label: 'Trend Line', pointsRequired: 2 },
      { id: 'advanced-ray', type: 'ray', label: 'Ray', pointsRequired: 2 },
      { id: 'advanced-fibonacci', type: 'fibonacci-retracement', label: 'Fibonacci Retracement', pointsRequired: 2 },
      { id: 'advanced-channel', type: 'parallel-channel', label: 'Parallel Channel', pointsRequired: 3 },
      { id: 'advanced-annotation', type: 'annotation', label: 'Annotation', pointsRequired: 1 },
    ],
    synchronizationEnhancements: [
      { id: 'symbol-sync', type: 'symbol-link', scope: 'linked-group', description: 'Chart panes share the selected symbol within a linked group.' },
      { id: 'timeframe-sync', type: 'timeframe-link', scope: 'linked-group', description: 'Compatible panes can follow timeframe changes.' },
      { id: 'drawing-sync', type: 'drawing-layer-link', scope: 'workspace', description: 'Drawing layer metadata remains tenant scoped and portable.' },
      { id: 'crosshair-sync', type: 'crosshair-link', scope: 'linked-group', description: 'Crosshair coordinates synchronize across linked panes.' },
    ],
    drawingLayerState: input.drawingLayerState,
    synchronizationState: input.synchronizationState,
    sourceReferences: [
      { id: 'institutional-chart-drawing-interaction', type: 'institutional-chart-drawing-interaction', eventType: drawingInteraction.eventType },
      { id: 'institutional-chart-layout', type: 'institutional-chart-layout', eventType: layout.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeInstitutionalChartAdvancedDrawingSyncRecord)
  const institutionalChartAdvancedDrawingSyncSummary = {
    total: states.length,
    ready: states.filter((item) => item.advancedDrawingSyncStatus === 'ready').length,
    caution: states.filter((item) => item.advancedDrawingSyncStatus === 'caution').length,
    blocked: states.filter((item) => item.advancedDrawingSyncStatus === 'blocked').length,
    totalAdvancedDrawingTools: states.reduce((sum, item) => sum + item.advancedDrawingTools.length, 0),
    totalSynchronizationEnhancements: states.reduce((sum, item) => sum + item.synchronizationEnhancements.length, 0),
    averageAdvancedDrawingSyncScore: states.length ? Math.round(states.reduce((sum, item) => sum + item.advancedDrawingSyncScore, 0) / states.length) : 0,
  }
  const institutionalChartAdvancedDrawingSyncStatus = institutionalChartAdvancedDrawingSyncSummary.blocked > 0 ? 'blocked' : institutionalChartAdvancedDrawingSyncSummary.caution > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_INSTITUTIONAL_CHART_ADVANCED_DRAWING_SYNC_PREPARED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    institutionalChartAdvancedDrawingSyncRecords: states,
    institutionalChartAdvancedDrawingSyncSummary,
    institutionalChartAdvancedDrawingSyncStatus,
    chartingOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
    destructiveAutomation: false,
    summary: `Institutional chart advanced drawing and synchronization ${institutionalChartAdvancedDrawingSyncStatus}: ${institutionalChartAdvancedDrawingSyncSummary.totalAdvancedDrawingTools} tools and ${institutionalChartAdvancedDrawingSyncSummary.totalSynchronizationEnhancements} synchronization enhancements prepared.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_INSTITUTIONAL_CHART_ADVANCED_DRAWING_SYNC_PREPARED_EVENT, result)
  return result
}
