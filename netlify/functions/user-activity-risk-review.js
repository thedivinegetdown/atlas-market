import { evaluateUserActivityRiskReview } from '../../lib/system/userActivityRiskReviewEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

export function createUserActivityRiskReviewHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, query, tenantContext, user }) => {
    const review = evaluateUserActivityRiskReview({
      tenantContext,
      requester: user,
      targetUserId: user.id,
      query,
      timeline: options.timeline,
      notifications: options.notifications,
      administrativeAuditRecords: options.administrativeAuditRecords,
      sessions: options.sessions,
      operatorActions: options.operatorActions,
      systemEvents: options.systemEvents,
    }, { emitEvent: false })
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'user-activity-risk-review', status: review.activityRiskStatus }),
      review,
      sensitiveMaterialExcluded: true,
      automaticTradingActions: false,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    }
  }, {
    allowedMethods: ['GET'],
    requiredPermission: 'dashboard.read',
    workspaceAction: 'read',
    routeId: 'user-activity-risk-review',
    ...options,
  })
}

export const handler = createUserActivityRiskReviewHandler()
