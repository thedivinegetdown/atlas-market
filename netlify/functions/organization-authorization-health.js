import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

export function createOrganizationAuthorizationHealthHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, user, organizationId, membership, workspaceAccess }) => ({
    event: apiFoundationEvent({ requestId, endpoint: 'organization-authorization-health' }),
    userId: user.id,
    organizationId,
    membershipRole: membership.role,
    workspaceAccess: workspaceAccess.accessStatus,
    crossOrganizationAccessDenied: workspaceAccess.crossOrganizationAccessDenied,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    billingEnabled: false,
  }), {
    allowedMethods: ['GET'],
    requiredPermission: 'dashboard.read',
    workspaceAction: 'read',
    routeId: 'organization-authorization-health',
    ...options,
  })
}

export const handler = createOrganizationAuthorizationHealthHandler()
