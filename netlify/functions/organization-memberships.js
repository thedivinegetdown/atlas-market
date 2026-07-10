import { updateOrganizationMembership } from '../../lib/auth/organizationRepository.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

export function createOrganizationMembershipsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, organizationId, query, body, event, membership }) => {
    const method = String(event.httpMethod ?? 'GET').toUpperCase()
    if (method === 'GET') {
      const memberships = await options.organizationMembershipRepository?.listMemberships?.(organizationId) ?? [membership]
      return {
        event: apiFoundationEvent({ requestId, endpoint: 'organization-memberships' }),
        memberships,
        paperTrading: true,
        liveOrders: false,
        brokerExecution: false,
        billingEnabled: false,
      }
    }
    const result = await updateOrganizationMembership({
      action: body.action ?? 'create',
      organizationId,
      userId: body.userId,
      role: body.role,
      membership: {
        id: body.id,
        organizationId,
        userId: body.userId,
        role: body.role,
      },
    }, {
      repository: options.organizationMembershipRepository,
      emitEvent: false,
    })
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'organization-memberships' }),
      result,
      requestedUserId: query.userId ?? body.userId,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
      billingEnabled: false,
    }
  }, {
    allowedMethods: ['GET', 'POST'],
    requiredPermission: 'workspace.admin',
    workspaceAction: 'administer',
    routeId: 'organization-memberships',
    ...options,
  })
}

export const handler = createOrganizationMembershipsHandler()
