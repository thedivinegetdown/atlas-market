import { createPersistenceApiHandler, listStore, apiFoundationEvent } from './_shared/persistenceApi.js'

export function createSystemEventsHandler(options = {}) {
  return createPersistenceApiHandler(async ({ repository, query, requestId }) => {
  const rows = await listStore(repository, 'systemEvents', query)
  return {
    paperTrading: true,
    systemEvents: rows,
    event: apiFoundationEvent({ requestId, endpoint: 'system-events:read' }),
  }
  }, options)
}

export const handler = createSystemEventsHandler()
