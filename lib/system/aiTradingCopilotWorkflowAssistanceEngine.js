import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_AI_TRADING_COPILOT_WORKFLOW_ASSISTANCE_PREPARED_EVENT = 'system.aiTradingCopilotWorkflowAssistance.prepared'
export const AI_TRADING_COPILOT_WORKFLOW_ASSISTANCE_STATUSES = Object.freeze(['ready', 'caution', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Number(value ?? 0)))
}

function safeStatus(status) {
  return AI_TRADING_COPILOT_WORKFLOW_ASSISTANCE_STATUSES.includes(status) ? status : 'caution'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

function normalizeWorkflowStep(step = {}) {
  return {
    id: String(step.id ?? 'step'),
    label: String(step.label ?? 'Review').slice(0, 140),
    category: String(step.category ?? 'review').slice(0, 80),
    priority: ['low', 'medium', 'high', 'critical'].includes(step.priority) ? step.priority : 'medium',
    status: ['open', 'acknowledged', 'resolved', 'blocked'].includes(step.status) ? step.status : 'open',
    rationale: String(step.rationale ?? 'Human operator review required.').slice(0, 260),
    sourceReferences: (step.sourceReferences ?? []).slice(0, 6).map(normalizeReference),
  }
}

export function normalizeAiTradingCopilotWorkflowAssistanceRecord(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `ai-trading-copilot-workflow-assistance-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    workflowStatus: safeStatus(input.workflowStatus ?? input.status),
    workflowScore: clampScore(input.workflowScore),
    workflowSummary: String(input.workflowSummary ?? 'Copilot workflow assistance prepared for human review.').slice(0, 700),
    nextBestActionSummary: String(input.nextBestActionSummary ?? 'Review the suggested workflow steps before manual paper-mode action.').slice(0, 700),
    workflowSteps: (input.workflowSteps ?? []).slice(0, 8).map(normalizeWorkflowStep),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    externalAiProvider: false,
    automaticOrderPlacement: false,
    automaticBrokerExecution: false,
    automaticDecisionOverride: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createAiTradingCopilotWorkflowAssistanceRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const workflow = normalizeAiTradingCopilotWorkflowAssistanceRecord(input)
      if (!database?.connected) return { ok: true, disabled: true, workflow }
      const result = await database.query(
        `INSERT INTO atlas_ai_trading_copilot_workflow_assistance
          (id, organization_id, team_workspace_id, workflow_status, workflow_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET workflow_status = EXCLUDED.workflow_status, workflow_score = EXCLUDED.workflow_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [workflow.id, workflow.tenantScope.organizationId, workflow.tenantScope.teamWorkspaceId, workflow.workflowStatus, workflow.workflowScore, workflow],
      )
      return { ok: true, workflow: normalizeAiTradingCopilotWorkflowAssistanceRecord(result.rows?.[0]?.payload ?? workflow) }
    },
    async list({ tenantContext = {}, workflowStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (workflowStatus) {
        params.push(safeStatus(workflowStatus))
        clauses.push(`workflow_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_ai_trading_copilot_workflow_assistance
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeAiTradingCopilotWorkflowAssistanceRecord(row.payload))
    },
  }
}

export function prepareAiTradingCopilotWorkflowAssistance(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.aiTradingCopilotWorkflowAssistanceRecords ?? input.aiTradingCopilotWorkflowAssistance ?? []
  const conversation = input.aiTradingCopilotConversation ?? {}
  const portfolioInsight = input.aiTradingCopilotPortfolioInsight ?? {}
  const tradeSignalExplanation = input.aiTradingCopilotTradeSignalExplanation ?? {}
  const operatorActions = input.operatorActionCenter ?? {}
  const commandPalette = input.workspaceCommandPalette ?? {}
  const conversationScore = clampScore(conversation.aiTradingCopilotConversationSummary?.averageConversationScore)
  const insightScore = clampScore(portfolioInsight.aiTradingCopilotPortfolioInsightSummary?.averageInsightScore ?? conversationScore)
  const explanationScore = clampScore(tradeSignalExplanation.aiTradingCopilotTradeSignalExplanationSummary?.averageExplanationScore ?? insightScore)
  const openActions = Number(operatorActions.platformActionSummary?.openActions ?? 0)
  const commandReadiness = commandPalette.commandExecutionResult?.status === 'executed' || commandPalette.commandExecutionResult?.status === 'ready' ? 90 : 70
  const actionPenalty = Math.min(30, openActions * 5)
  const score = Math.max(0, Math.round(((conversationScore + insightScore + explanationScore + commandReadiness) / 4) - actionPenalty))
  const workflowStatus = score >= 85 ? 'ready' : score >= 60 ? 'caution' : 'blocked'
  const sourceItems = Array.isArray(supplied) ? supplied : [supplied]
  const workflows = (sourceItems.length ? sourceItems : [normalizeAiTradingCopilotWorkflowAssistanceRecord({
    tenantContext,
    workflowStatus,
    workflowScore: score,
    workflowSummary: `Copilot workflow assistance is ${workflowStatus}; conversation ${conversationScore}, portfolio insight ${insightScore}, trade signal explanation ${explanationScore}, command readiness ${commandReadiness}, and open action penalty ${actionPenalty} reviewed.`,
    nextBestActionSummary: workflowStatus === 'ready'
      ? 'Proceed with human review of paper-mode decision context, then use existing workspace actions only.'
      : 'Resolve open operator actions or review risk/research context before manual paper-mode workflow steps.',
    workflowSteps: [
      { id: 'review-conversation', label: 'Review conversational portfolio analysis', category: 'review', priority: workflowStatus === 'blocked' ? 'high' : 'medium', status: 'open', rationale: 'Confirm portfolio and research summary before manual paper workflow.', sourceReferences: [{ id: 'conversation', type: 'copilot-conversation', eventType: conversation.eventType }] },
      { id: 'review-signal-explanation', label: 'Review trade and signal confidence reasoning', category: 'review', priority: 'medium', status: 'open', rationale: 'Confirm signal rationale, guardrail, and sizing context.', sourceReferences: [{ id: 'trade-signal-explanation', type: 'trade-signal-explanation', eventType: tradeSignalExplanation.eventType }] },
      { id: 'review-portfolio-insights', label: 'Review strategy comparison and portfolio insights', category: 'monitor', priority: 'medium', status: 'open', rationale: 'Confirm exposure, risk, and optimization context.', sourceReferences: [{ id: 'portfolio-insight', type: 'portfolio-insight', eventType: portfolioInsight.eventType }] },
      { id: 'resolve-operator-actions', label: 'Resolve open operator actions', category: 'operator-review', priority: openActions > 0 ? 'high' : 'low', status: openActions > 0 ? 'open' : 'resolved', rationale: `${openActions} open operator actions reflected in workflow readiness.`, sourceReferences: [{ id: 'operator-actions', type: 'operator-action-center', eventType: operatorActions.eventType }] },
    ],
    sourceReferences: [
      { id: 'copilot-conversation', type: 'copilot-conversation', eventType: conversation.eventType },
      { id: 'portfolio-insight', type: 'portfolio-insight', eventType: portfolioInsight.eventType },
      { id: 'trade-signal-explanation', type: 'trade-signal-explanation', eventType: tradeSignalExplanation.eventType },
      { id: 'operator-actions', type: 'operator-action-center', eventType: operatorActions.eventType },
      { id: 'command-palette', type: 'workspace-command-palette', eventType: commandPalette.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeAiTradingCopilotWorkflowAssistanceRecord)
  const aiTradingCopilotWorkflowAssistanceSummary = {
    total: workflows.length,
    ready: workflows.filter((item) => item.workflowStatus === 'ready').length,
    caution: workflows.filter((item) => item.workflowStatus === 'caution').length,
    blocked: workflows.filter((item) => item.workflowStatus === 'blocked').length,
    openSteps: workflows.reduce((sum, item) => sum + item.workflowSteps.filter((step) => step.status === 'open').length, 0),
    averageWorkflowScore: workflows.length ? Math.round(workflows.reduce((sum, item) => sum + item.workflowScore, 0) / workflows.length) : 0,
  }
  const aiTradingCopilotWorkflowAssistanceStatus = aiTradingCopilotWorkflowAssistanceSummary.blocked > 0 ? 'blocked' : aiTradingCopilotWorkflowAssistanceSummary.caution > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_AI_TRADING_COPILOT_WORKFLOW_ASSISTANCE_PREPARED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    aiTradingCopilotWorkflowAssistanceRecords: workflows,
    aiTradingCopilotWorkflowAssistanceSummary,
    aiTradingCopilotWorkflowAssistanceStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    externalAiProvider: false,
    automaticOrderPlacement: false,
    automaticBrokerExecution: false,
    automaticDecisionOverride: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `AI trading copilot workflow assistance ${aiTradingCopilotWorkflowAssistanceStatus}: average workflow score ${aiTradingCopilotWorkflowAssistanceSummary.averageWorkflowScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_AI_TRADING_COPILOT_WORKFLOW_ASSISTANCE_PREPARED_EVENT, result)
  return result
}
