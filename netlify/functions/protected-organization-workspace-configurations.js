import { apiFoundationEvent, listStore, upsertStore } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

export function createProtectedOrganizationWorkspaceConfigurationsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, repository, query, body, event, organizationId, workspaceAccess }) => {
    const method = String(event.httpMethod ?? 'GET').toUpperCase()
    const result = method === 'GET'
      ? await listStore(repository, 'workspaceConfigurations', query)
      : await upsertStore(repository, 'workspaceConfigurations', {
        ...body,
        payload: {
          ...(body.payload ?? {}),
          organizationId,
        },
      })
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'protected-organization-workspace-configurations' }),
      workspaceAccess: workspaceAccess.accessStatus,
      organizationId,
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
    workspaceAction: options.workspaceAction ?? 'write',
    routeId: 'protected-organization-workspace-configurations',
    ...options,
  })
}

export const handler = createProtectedOrganizationWorkspaceConfigurationsHandler()
