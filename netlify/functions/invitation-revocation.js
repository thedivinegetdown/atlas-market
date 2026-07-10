import { updateMembershipInvitation } from '../../lib/auth/invitationRepository.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'

export function createInvitationRevocationHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body }) => {
    const result = await updateMembershipInvitation({
      action: 'revoke',
      invitationId: body.invitationId,
    }, { repository: options.invitationRepository, emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'invitation-revocation' }), result, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, {
    allowedMethods: ['POST'],
    requiredPermission: 'workspace.admin',
    workspaceAction: 'administer',
    routeId: 'invitation-revocation',
    ...options,
  })
}

export const handler = createInvitationRevocationHandler()
