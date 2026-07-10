import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceReviewCalendarRepository, generateComplianceReviewCalendar } from '../../lib/system/complianceReviewCalendarEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance review calendar access denied', { statusCode: 403, publicMessage: 'compliance review calendar access denied' })
}

export function createComplianceReviewCalendarHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceReviewCalendarRepository ?? createComplianceReviewCalendarRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.calendarItem, tenantContext })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-review-calendar', status: response.ok ? 'scheduled' : 'blocked' }), calendarItem: response.item, automaticScheduling: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, itemStatus: query.itemStatus, itemType: query.itemType, limit: query.limit }) ?? []
    const complianceReviewCalendar = generateComplianceReviewCalendar({ tenantContext, complianceReviewCalendarItems: existing, complianceReviewWorkflow: options.complianceReviewWorkflow, complianceReviewSla: options.complianceReviewSla, complianceEscalationPlanning: options.complianceEscalationPlanning }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-review-calendar', status: complianceReviewCalendar.calendarStatus }), complianceReviewCalendar, automaticScheduling: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-review-calendar', ...options })
}

export const handler = createComplianceReviewCalendarHandler()
