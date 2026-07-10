import { updateMembershipInvitation } from '../../lib/auth/invitationRepository.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createTeamAuthenticatedApiHandler } from './_shared/authApi.js'

export function createTeamWorkspaceInvitationsHandler(options = {}) {
  return createTeamAuthenticatedApiHandler(async ({ requestId, teamWorkspace, teamMembership, event, body }) => {
    const method = String(event.httpMethod ?? 'GET').toUpperCase()
    if (method === 'GET') {
      const invitations = await options.invitationRepository?.listInvitations?.({ organizationId: teamWorkspace.organizationId, teamWorkspaceId: teamWorkspace.id }) ?? []
      return { event: apiFoundationEvent({ requestId, endpoint: 'team-workspace-invitations' }), invitations, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const result = await updateMembershipInvitation({
      action: body.action ?? 'create',
      inviterRole: teamMembership.role,
      invitation: { ...body, organizationId: teamWorkspace.organizationId, teamWorkspaceId: teamWorkspace.id },
    }, { repository: options.invitationRepository, emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'team-workspace-invitations' }), result, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, {
    allowedMethods: ['GET', 'POST'],
    requiredPermission: 'workspace.admin',
    teamAction: 'invite',
    routeId: 'team-workspace-invitations',
    ...options,
  })
}

export const handler = createTeamWorkspaceInvitationsHandler()
