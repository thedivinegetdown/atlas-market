import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createTeamAuthenticatedApiHandler } from './_shared/authApi.js'

export function createCurrentTeamWorkspaceHandler(options = {}) {
  return createTeamAuthenticatedApiHandler(async ({ requestId, teamWorkspace, teamMembership, teamWorkspaceAccess }) => ({
    event: apiFoundationEvent({ requestId, endpoint: 'current-team-workspace' }),
    teamWorkspace,
    teamMembership,
    teamWorkspaceAccess: teamWorkspaceAccess.accessStatus,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    billingEnabled: false,
  }), {
    allowedMethods: ['GET'],
    requiredPermission: 'dashboard.read',
    teamAction: 'read',
    routeId: 'current-team-workspace',
    ...options,
  })
}

export const handler = createCurrentTeamWorkspaceHandler()
