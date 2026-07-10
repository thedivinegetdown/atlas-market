import { updateMembershipInvitation } from '../../lib/auth/invitationRepository.js'
import { createAuthenticatedApiHandler } from './_shared/authApi.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'

export function createInvitationAcceptanceHandler(options = {}) {
  return createAuthenticatedApiHandler(async ({ requestId, body, user }) => {
    const result = await updateMembershipInvitation({
      action: 'accept',
      token: body.token,
      acceptedByUserId: user.id,
    }, { repository: options.invitationRepository, emitEvent: false, now: options.now })
    if (result.status === 'blocked') return { ok: false, statusCode: 400, error: { code: result.error?.code ?? 'invitation_failed', message: 'invitation cannot be accepted' } }
    return { event: apiFoundationEvent({ requestId, endpoint: 'invitation-acceptance' }), result, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, {
    allowedMethods: ['POST'],
    requiredPermission: 'dashboard.read',
    routeId: 'invitation-acceptance',
    ...options,
  })
}

export const handler = createInvitationAcceptanceHandler()
