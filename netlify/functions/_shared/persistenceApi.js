import { AppError, ERROR_CODES } from '../../../lib/errors/appError.js'
import { createPostgresRepository } from '../../../lib/db/postgresRepository.js'
import { createApiHandler } from './api.js'

const SAFE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/

export const PERSISTENCE_API_INITIALIZED_EVENT = 'system.apiFoundation.initialized'

export function sanitizeId(value, fieldName = 'id') {
  const id = String(value ?? '').trim()
  if (!SAFE_ID_PATTERN.test(id)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, `${fieldName} is invalid`, {
      statusCode: 400,
      publicMessage: `${fieldName} is invalid`,
      metadata: { fieldName },
    })
  }
  return id
}

export function validateObjectPayload(value, fieldName = 'payload') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, `${fieldName} must be an object`, {
      statusCode: 400,
      publicMessage: `${fieldName} must be an object`,
      metadata: { fieldName },
    })
  }
  return value
}

function parseLimit(value) {
  const limit = Number(value ?? 50)
  if (!Number.isFinite(limit)) return 50
  return Math.min(100, Math.max(1, Math.trunc(limit)))
}

export function createPersistenceRepositoryFactory({ repositoryFactory = createPostgresRepository } = {}) {
  return () => repositoryFactory()
}

export function createPersistenceApiHandler(resolver, options = {}) {
  const repositoryFactory = options.repositoryFactory ?? createPostgresRepository
  return createApiHandler(async (context) => {
    const repository = repositoryFactory()
    try {
      return await resolver({ ...context, repository })
    } finally {
      await repository.end?.()
    }
  }, {
    ...options,
    serviceFactory: () => ({}),
  })
}

export async function listStore(repository, storeName, query = {}) {
  const store = repository.getStore(storeName)
  if (!store) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'persistence store is invalid', {
      statusCode: 400,
      publicMessage: 'persistence store is invalid',
      metadata: { storeName },
    })
  }
  return store.list({ limit: parseLimit(query.limit) })
}

export async function upsertStore(repository, storeName, body = {}) {
  const store = repository.getStore(storeName)
  if (!store) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'persistence store is invalid', {
      statusCode: 400,
      publicMessage: 'persistence store is invalid',
      metadata: { storeName },
    })
  }
  const id = sanitizeId(body.id)
  const payload = validateObjectPayload(body.payload)
  return store.upsert(id, payload)
}

export function apiFoundationEvent({ requestId, endpoint, status = 'ready' } = {}) {
  return {
    eventType: PERSISTENCE_API_INITIALIZED_EVENT,
    requestId,
    endpoint,
    status,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    secretsExposed: false,
  }
}
