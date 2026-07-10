import { createPersistenceApiHandler, listStore, apiFoundationEvent } from './_shared/persistenceApi.js'

export function createOperatorActionsHandler(options = {}) {
  return createPersistenceApiHandler(async ({ repository, query, requestId }) => {
  const rows = await listStore(repository, 'operatorActions', query)
  return {
    paperTrading: true,
    operatorActions: rows,
    event: apiFoundationEvent({ requestId, endpoint: 'operator-actions:read' }),
  }
  }, options)
}

export const handler = createOperatorActionsHandler()
