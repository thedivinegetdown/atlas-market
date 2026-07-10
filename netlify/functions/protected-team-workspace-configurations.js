import { apiFoundationEvent, listStore, upsertStore } from './_shared/persistenceApi.js'
import { createTeamAuthenticatedApiHandler } from './_shared/authApi.js'

export function createProtectedTeamWorkspaceConfigurationsHandler(options = {}) {
  return createTeamAuthenticatedApiHandler(async ({ requestId, repository, query, body, event, teamWorkspace, teamWorkspaceAccess }) => {
    const method = String(event.httpMethod ?? 'GET').toUpperCase()
    const result = method === 'GET'
      ? await listStore(repository, 'workspaceConfigurations', query)
      : await upsertStore(repository, 'workspaceConfigurations', {
        ...body,
        payload: {
          ...(body.payload ?? {}),
          organizationId: teamWorkspace.organizationId,
          teamWorkspaceId: teamWorkspace.id,
        },
      })
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'protected-team-workspace-configurations' }),
      teamWorkspaceAccess: teamWorkspaceAccess.accessStatus,
      teamWorkspaceId: teamWorkspace.id,
      workspaceConfigurations: method === 'GET' ? result : undefined,
      result: method === 'POST' ? result : undefined,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
      billingEnabled: false,
    }
  }, {
    allowedMethods: ['GET', 'POST'],
    requiredPermission: options.requiredPermission ?? 'workspace.admin',
    teamAction: options.teamAction ?? 'write',
    routeId: 'protected-team-workspace-configurations',
    ...options,
  })
}

export const handler = createProtectedTeamWorkspaceConfigurationsHandler()
