import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'

function statusFromSections(sections) {
  if (sections.some((section) => section.status === 'blocked')) return 'blocked'
  if (sections.some((section) => section.status === 'degraded')) return 'degraded'
  if (sections.some((section) => section.status === 'caution')) return 'caution'
  return 'healthy'
}

export function createRealtimePaperExecutionOperationsHealthHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, tenantContext }) => {
    const decisionSummary = options.realtimePaperDecisions?.realtimePaperDecisionSummary ?? {}
    const preparationSummary = options.realtimePreparedTrades?.realtimePreparedTradeSummary ?? {}
    const executionSummary = options.realtimeSimulatedExecutions?.realtimeSimulatedExecutionSummary ?? {}
    const sections = [
      { id: 'paper-decision', label: 'Paper decision coordination', status: decisionSummary.rejected > 0 && !decisionSummary.approved ? 'caution' : 'healthy', summary: decisionSummary },
      { id: 'trade-preparation', label: 'Position sizing and guardrail preparation', status: preparationSummary.blocked > 0 && !preparationSummary.ready ? 'blocked' : preparationSummary.caution > 0 ? 'caution' : 'healthy', summary: preparationSummary },
      { id: 'simulated-execution', label: 'Simulated execution lifecycle', status: executionSummary.failed > 0 ? 'degraded' : executionSummary.rejected > 0 && !executionSummary.simulated ? 'caution' : 'healthy', summary: executionSummary },
      { id: 'paper-safety', label: 'Paper-mode invariant', status: 'healthy', paperTrading: true, liveOrders: false, brokerExecution: false },
    ]
    const operationalStatus = statusFromSections(sections)
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'realtime-paper-execution-operations-health', status: operationalStatus }),
      tenantScope: {
        organizationId: tenantContext.organizationId,
        teamWorkspaceId: tenantContext.teamWorkspaceId,
      },
      realtimePaperExecutionOperations: {
        operationalStatus,
        sections,
        paperTrading: true,
        liveOrders: false,
        brokerExecution: false,
        automaticTrading: false,
      },
    }
  }, { allowedMethods: ['GET'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'realtime-paper-execution-operations-health', ...options })
}

export const handler = createRealtimePaperExecutionOperationsHealthHandler()
