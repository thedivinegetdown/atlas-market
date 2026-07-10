import { createPersistenceApiHandler, apiFoundationEvent } from './_shared/persistenceApi.js'

export function createDatabaseHealthHandler(options = {}) {
  return createPersistenceApiHandler(async ({ repository, requestId }) => {
  const initialization = await repository.initialize()
  const health = initialization.health ?? await repository.healthCheck()
  return {
    paperTrading: true,
    health,
    migration: initialization.migration,
    event: apiFoundationEvent({ requestId, endpoint: 'database-health', status: health.status }),
  }
  }, options)
}

export const handler = createDatabaseHealthHandler()
