import { updateMembershipInvitation } from '../../lib/auth/invitationRepository.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

export function createOrganizationInvitationsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, organizationId, event, body, membership }) => {
    const method = String(event.httpMethod ?? 'GET').toUpperCase()
    if (method === 'GET') {
      const invitations = await options.invitationRepository?.listInvitations?.({ organizationId }) ?? []
      return { event: apiFoundationEvent({ requestId, endpoint: 'organization-invitations' }), invitations, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const result = await updateMembershipInvitation({
      action: body.action ?? 'create',
      inviterRole: membership.role,
      invitation: { ...body, organizationId },
    }, { repository: options.invitationRepository, emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'organization-invitations' }), result, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, {
    allowedMethods: ['GET', 'POST'],
    requiredPermission: 'workspace.admin',
    workspaceAction: 'administer',
    routeId: 'organization-invitations',
    ...options,
  })
}

export const handler = createOrganizationInvitationsHandler()
