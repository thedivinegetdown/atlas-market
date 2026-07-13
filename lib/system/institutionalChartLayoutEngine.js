import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_INSTITUTIONAL_CHART_LAYOUT_SYNCHRONIZED_EVENT = 'system.institutionalChartLayout.synchronized'
export const INSTITUTIONAL_CHART_LAYOUT_STATUSES = Object.freeze(['ready', 'caution', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Number(value ?? 0)))
}

function safeStatus(status) {
  return INSTITUTIONAL_CHART_LAYOUT_STATUSES.includes(status) ? status : 'caution'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

function normalizeLayoutCell(cell = {}, index = 0) {
  return {
    id: String(cell.id ?? `layout-cell-${index + 1}`),
    paneId: String(cell.paneId ?? cell.id ?? `chart-pane-${index + 1}`),
    row: Number.isFinite(Number(cell.row)) ? Number(cell.row) : Math.floor(index / 2),
    column: Number.isFinite(Number(cell.column)) ? Number(cell.column) : index % 2,
    width: Number.isFinite(Number(cell.width)) ? Number(cell.width) : 1,
    height: Number.isFinite(Number(cell.height)) ? Number(cell.height) : 1,
  }
}

function normalizeSyncGroup(group = {}) {
  return {
    id: String(group.id ?? 'primary'),
    symbolLinked: group.symbolLinked !== false,
    crosshairLinked: group.crosshairLinked !== false,
    timeframeLinked: group.timeframeLinked !== false,
    synchronizedTimeframe: String(group.synchronizedTimeframe ?? '1d').toLowerCase().slice(0, 20),
    paneIds: (group.paneIds ?? []).slice(0, 12).map((paneId) => String(paneId).slice(0, 80)),
  }
}

export function normalizeInstitutionalChartLayoutRecord(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `institutional-chart-layout-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    layoutStatus: safeStatus(input.layoutStatus ?? input.status),
    layoutScore: clampScore(input.layoutScore),
    layoutName: String(input.layoutName ?? 'Two Panel Institutional Layout').slice(0, 140),
    layoutTemplate: String(input.layoutTemplate ?? 'two-up').slice(0, 80),
    layoutCells: (input.layoutCells ?? []).slice(0, 12).map(normalizeLayoutCell),
    synchronizationGroups: (input.synchronizationGroups ?? []).slice(0, 6).map(normalizeSyncGroup),
    timeframeSynchronizationSummary: {
      enabled: input.timeframeSynchronizationSummary?.enabled !== false,
      synchronizedGroups: Number(input.timeframeSynchronizationSummary?.synchronizedGroups ?? 0),
      primaryTimeframe: String(input.timeframeSynchronizationSummary?.primaryTimeframe ?? '1d').toLowerCase().slice(0, 20),
      compatible: input.timeframeSynchronizationSummary?.compatible !== false,
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

export function createInstitutionalChartLayoutRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const layout = normalizeInstitutionalChartLayoutRecord(input)
      if (!database?.connected) return { ok: true, disabled: true, layout }
      const result = await database.query(
        `INSERT INTO atlas_institutional_chart_layouts
          (id, organization_id, team_workspace_id, layout_status, layout_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET layout_status = EXCLUDED.layout_status, layout_score = EXCLUDED.layout_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [layout.id, layout.tenantScope.organizationId, layout.tenantScope.teamWorkspaceId, layout.layoutStatus, layout.layoutScore, layout],
      )
      return { ok: true, layout: normalizeInstitutionalChartLayoutRecord(result.rows?.[0]?.payload ?? layout) }
    },
    async list({ tenantContext = {}, layoutStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (layoutStatus) {
        params.push(safeStatus(layoutStatus))
        clauses.push(`layout_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_institutional_chart_layouts
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeInstitutionalChartLayoutRecord(row.payload))
    },
  }
}

export function synchronizeInstitutionalChartLayout(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.institutionalChartLayouts ?? input.institutionalChartLayout ?? []
  const workspace = input.institutionalChartWorkspace ?? {}
  const firstWorkspace = workspace.institutionalChartWorkspaces?.[0] ?? workspace
  const panes = firstWorkspace.chartPanes ?? []
  const paneIds = panes.map((pane) => pane.id)
  const primaryTimeframe = panes[0]?.timeframe ?? '1d'
  const synchronizedPanes = panes.filter((pane) => pane.linkedGroupId === (panes[0]?.linkedGroupId ?? 'primary')).length
  const syncScore = panes.length > 1 ? Math.round((synchronizedPanes / panes.length) * 100) : panes.length === 1 ? 85 : 35
  const workspaceScore = clampScore(workspace.institutionalChartWorkspaceSummary?.averageWorkspaceScore ?? firstWorkspace.workspaceScore ?? syncScore)
  const score = Math.round((syncScore + workspaceScore + 85) / 3)
  const layoutStatus = score >= 85 ? 'ready' : score >= 60 ? 'caution' : 'blocked'
  const sourceItems = Array.isArray(supplied) ? supplied : [supplied]
  const layouts = (sourceItems.length ? sourceItems : [normalizeInstitutionalChartLayoutRecord({
    tenantContext,
    layoutStatus,
    layoutScore: score,
    layoutName: input.layoutName,
    layoutTemplate: panes.length >= 4 ? 'quad-grid' : panes.length === 3 ? 'three-panel' : 'two-up',
    layoutCells: panes.map((pane, index) => ({ id: `cell-${pane.id}`, paneId: pane.id, row: Math.floor(index / 2), column: index % 2, width: 1, height: 1 })),
    synchronizationGroups: [{ id: panes[0]?.linkedGroupId ?? 'primary', paneIds, synchronizedTimeframe: primaryTimeframe }],
    timeframeSynchronizationSummary: {
      enabled: true,
      synchronizedGroups: panes.length > 0 ? 1 : 0,
      primaryTimeframe,
      compatible: panes.every((pane) => firstWorkspace.supportedTimeframes?.includes(pane.timeframe) !== false),
    },
    sourceReferences: [{ id: 'institutional-chart-workspace', type: 'institutional-chart-workspace', eventType: workspace.eventType }],
    timestamp: options.timestamp,
  })]).map(normalizeInstitutionalChartLayoutRecord)
  const institutionalChartLayoutSummary = {
    total: layouts.length,
    ready: layouts.filter((item) => item.layoutStatus === 'ready').length,
    caution: layouts.filter((item) => item.layoutStatus === 'caution').length,
    blocked: layouts.filter((item) => item.layoutStatus === 'blocked').length,
    totalLayoutCells: layouts.reduce((sum, item) => sum + item.layoutCells.length, 0),
    synchronizedGroups: layouts.reduce((sum, item) => sum + item.synchronizationGroups.length, 0),
    averageLayoutScore: layouts.length ? Math.round(layouts.reduce((sum, item) => sum + item.layoutScore, 0) / layouts.length) : 0,
  }
  const institutionalChartLayoutStatus = institutionalChartLayoutSummary.blocked > 0 ? 'blocked' : institutionalChartLayoutSummary.caution > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_INSTITUTIONAL_CHART_LAYOUT_SYNCHRONIZED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    institutionalChartLayouts: layouts,
    institutionalChartLayoutSummary,
    institutionalChartLayoutStatus,
    chartingOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
    destructiveAutomation: false,
    summary: `Institutional chart layout ${institutionalChartLayoutStatus}: ${institutionalChartLayoutSummary.totalLayoutCells} chart cells and ${institutionalChartLayoutSummary.synchronizedGroups} sync groups prepared.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_INSTITUTIONAL_CHART_LAYOUT_SYNCHRONIZED_EVENT, result)
  return result
}
