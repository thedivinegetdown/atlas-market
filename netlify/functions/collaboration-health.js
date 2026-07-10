import { evaluateWorkspaceCollaborationOperations } from '../../lib/system/workspaceCollaborationOperationsEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createTeamAuthenticatedApiHandler } from './_shared/authApi.js'

export function createCollaborationHealthHandler(options = {}) {
  return createTeamAuthenticatedApiHandler(async ({ requestId, teamMembership, teamWorkspaceAccess }) => {
    const operations = evaluateWorkspaceCollaborationOperations({
      teamWorkspaceAccess,
      activeCollaborators: [teamMembership],
      pendingInvitations: [],
    }, { emitEvent: false })
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'collaboration-health' }),
      operations,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
      billingEnabled: false,
    }
  }, {
    allowedMethods: ['GET'],
    requiredPermission: 'dashboard.read',
    teamAction: 'read',
    routeId: 'collaboration-health',
    ...options,
  })
}

export const handler = createCollaborationHealthHandler()
