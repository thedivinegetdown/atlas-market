import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createAiTradingCopilotWorkflowAssistanceRepository, prepareAiTradingCopilotWorkflowAssistance } from '../../lib/system/aiTradingCopilotWorkflowAssistanceEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertTradingDeskAccess(membership) {
  if (!['owner', 'admin', 'analyst'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'AI trading copilot workflow assistance access denied', { statusCode: 403, publicMessage: 'AI trading copilot workflow assistance access denied' })
}

export function createAiTradingCopilotWorkflowAssistanceHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertTradingDeskAccess(membership)
    const repository = options.aiTradingCopilotWorkflowAssistanceRepository ?? createAiTradingCopilotWorkflowAssistanceRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const persistence = await repository.create({ ...body.workflow, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'ai-trading-copilot-workflow-assistance', status: persistence.ok ? 'prepared' : 'blocked' }), workflow: persistence.workflow, externalAiProvider: false, automaticOrderPlacement: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, workflowStatus: query.workflowStatus, limit: query.limit }) ?? []
    const aiTradingCopilotWorkflowAssistance = prepareAiTradingCopilotWorkflowAssistance({ tenantContext, aiTradingCopilotWorkflowAssistanceRecords: existing, aiTradingCopilotConversation: options.aiTradingCopilotConversation, aiTradingCopilotPortfolioInsight: options.aiTradingCopilotPortfolioInsight, aiTradingCopilotTradeSignalExplanation: options.aiTradingCopilotTradeSignalExplanation, operatorActionCenter: options.operatorActionCenter, workspaceCommandPalette: options.workspaceCommandPalette }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'ai-trading-copilot-workflow-assistance', status: aiTradingCopilotWorkflowAssistance.aiTradingCopilotWorkflowAssistanceStatus }), aiTradingCopilotWorkflowAssistance, externalAiProvider: false, automaticOrderPlacement: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'paperTrading.read', workspaceAction: 'read', routeId: 'ai-trading-copilot-workflow-assistance', ...options })
}

export const handler = createAiTradingCopilotWorkflowAssistanceHandler()
