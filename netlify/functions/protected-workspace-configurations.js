import { apiFoundationEvent, listStore, upsertStore } from './_shared/persistenceApi.js'
import { createAuthenticatedApiHandler } from './_shared/authApi.js'

export function createProtectedWorkspaceConfigurationsHandler(options = {}) {
  return createAuthenticatedApiHandler(async ({ requestId, repository, query, body, event, authorization }) => {
    const method = String(event.httpMethod ?? 'GET').toUpperCase()
    const result = method === 'GET'
      ? await listStore(repository, 'workspaceConfigurations', query)
      : await upsertStore(repository, 'workspaceConfigurations', body)
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'protected-workspace-configurations' }),
      authorization: authorization.authorizationStatus,
      workspaceConfigurations: method === 'GET' ? result : undefined,
      result: method === 'POST' ? result : undefined,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    }
  }, {
    allowedMethods: ['GET', 'POST'],
    requiredPermission: options.requiredPermission ?? 'workspace.admin',
    routeId: 'protected-workspace-configurations',
    ...options,
  })
}

export const handler = createProtectedWorkspaceConfigurationsHandler()
