import { createPersistenceApiHandler, listStore, upsertStore, apiFoundationEvent } from './_shared/persistenceApi.js'

export function createWorkspaceConfigurationsHandler(options = {}) {
  return createPersistenceApiHandler(async ({ repository, query, body, requestId, event }) => {
  if (event.httpMethod === 'POST') {
    const result = await upsertStore(repository, 'workspaceConfigurations', body)
    return {
      paperTrading: true,
      result,
      event: apiFoundationEvent({ requestId, endpoint: 'workspace-configurations:write' }),
    }
  }

  const rows = await listStore(repository, 'workspaceConfigurations', query)
  return {
    paperTrading: true,
    workspaceConfigurations: rows,
    event: apiFoundationEvent({ requestId, endpoint: 'workspace-configurations:read' }),
  }
  }, { allowedMethods: ['GET', 'POST'], ...options })
}

export const handler = createWorkspaceConfigurationsHandler()
