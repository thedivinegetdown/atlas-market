import { updateTeamMembership } from '../../lib/auth/teamWorkspaceRepository.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createTeamAuthenticatedApiHandler } from './_shared/authApi.js'

export function createTeamWorkspaceMembershipsHandler(options = {}) {
  return createTeamAuthenticatedApiHandler(async ({ requestId, teamWorkspace, teamMembership, event, body }) => {
    const method = String(event.httpMethod ?? 'GET').toUpperCase()
    if (method === 'GET') {
      const memberships = await options.teamMembershipRepository?.listMemberships?.(teamWorkspace.id) ?? [teamMembership]
      return {
        event: apiFoundationEvent({ requestId, endpoint: 'team-workspace-memberships' }),
        memberships,
        paperTrading: true,
        liveOrders: false,
        brokerExecution: false,
        billingEnabled: false,
      }
    }
    const result = await updateTeamMembership({
      action: body.action ?? 'create',
      teamWorkspaceId: teamWorkspace.id,
      userId: body.userId,
      role: body.role,
      membership: {
        id: body.id,
        organizationId: teamWorkspace.organizationId,
        teamWorkspaceId: teamWorkspace.id,
        userId: body.userId,
        role: body.role,
      },
    }, {
      repository: options.teamMembershipRepository,
      emitEvent: false,
    })
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'team-workspace-memberships' }),
      result,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
      billingEnabled: false,
    }
  }, {
    allowedMethods: ['GET', 'POST'],
    requiredPermission: 'workspace.admin',
    teamAction: 'administer',
    routeId: 'team-workspace-memberships',
    ...options,
  })
}

export const handler = createTeamWorkspaceMembershipsHandler()
