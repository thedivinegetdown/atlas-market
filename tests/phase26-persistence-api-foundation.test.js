import { describe, expect, it, vi } from 'vitest'
import { createEventBus } from '../lib/core/eventBus.js'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import {
  DATABASE_PERSISTENCE_INITIALIZED_EVENT,
  createDatabaseAdapter,
  createPostgresRepository,
  initializeDatabasePersistence,
  normalizePersistenceError,
} from '../lib/db/postgresRepository.js'
import {
  SYSTEM_PERSISTENCE_API_INTEGRATION_EVALUATED_EVENT,
  createPersistenceApiIntegrationEngine,
  evaluatePersistenceApiIntegration,
} from '../lib/system/persistenceApiIntegrationEngine.js'
import { createDatabaseHealthHandler } from '../netlify/functions/database-health.js'
import { createWorkspaceConfigurationsHandler } from '../netlify/functions/workspace-configurations.js'
import { createSystemEventsHandler } from '../netlify/functions/system-events.js'
import { createOperatorActionsHandler } from '../netlify/functions/operator-actions.js'

function parseResponse(response) {
  return {
    ...response,
    json: response.body ? JSON.parse(response.body) : null,
  }
}

function jsonEvent(body, method = 'POST') {
  return {
    httpMethod: method,
    headers: {
      'content-type': 'application/json',
      'x-request-id': 'req-phase26',
    },
    body: JSON.stringify(body),
  }
}

function createMockRepository(rowsByStore = {}) {
  const stores = new Map()
  const getStore = (name) => {
    if (!stores.has(name)) {
      stores.set(name, {
        list: vi.fn(async () => rowsByStore[name] ?? []),
        upsert: vi.fn(async (id, payload) => ({ ok: true, data: { id, payload } })),
      })
    }
    return stores.get(name)
  }
  return {
    initialize: vi.fn(async () => ({
      ok: true,
      health: { status: 'healthy', connected: true },
      migration: { ok: true, applied: [], skipped: ['phase26'] },
    })),
    healthCheck: vi.fn(async () => ({ status: 'healthy', connected: true })),
    getStore,
    end: vi.fn(async () => {}),
    stores,
  }
}

describe('Phase 26A PostgreSQL persistence foundation', () => {
  it('builds repeatable migration SQL for the initial persistence models', () => {
    const sql = buildMigrationSql()

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_workspace_configurations')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_workspace_sessions')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_system_events')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_enterprise_audit_records')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_operator_actions')
    expect(sql).not.toContain('DROP TABLE')
  })

  it('returns disabled migration state without connecting to a database', async () => {
    const result = await runMigrations({ connected: false })

    expect(result.ok).toBe(true)
    expect(result.disabled).toBe(true)
    expect(result.applied).toEqual([])
  })

  it('enforces parameterized query params and supports transactions', async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }))
    const release = vi.fn()
    const adapter = createDatabaseAdapter({
      client: {
        connected: true,
        query,
        connect: async () => ({ query, release }),
        end: async () => {},
      },
    })

    await expect(adapter.query('SELECT $1')).rejects.toThrow('Parameterized query requires')
    await adapter.query('SELECT $1', ['ok'])
    await adapter.transaction(async (client) => client.query('SELECT $1', ['tx']))

    expect(query).toHaveBeenCalledWith('BEGIN')
    expect(query).toHaveBeenCalledWith('COMMIT')
    expect(release).toHaveBeenCalled()
  })

  it('normalizes persistence errors without leaking internal messages publicly', () => {
    const result = normalizePersistenceError(new Error('database connection failed with internal details'))

    expect(result.ok).toBe(false)
    expect(result.error.message).toBe('database operation failed')
    expect(result.error).not.toHaveProperty('internalMessage')
    expect(JSON.stringify(result)).not.toContain('internal details')
  })

  it('emits database persistence initialized events with repository metadata', async () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(DATABASE_PERSISTENCE_INITIALIZED_EVENT, (payload) => events.push(payload))
    const repository = {
      initialize: vi.fn(async () => ({
        ok: true,
        health: { status: 'healthy', connected: true },
        migration: { ok: true, applied: ['phase26'], skipped: [] },
      })),
      healthCheck: vi.fn(),
      transaction: vi.fn(),
    }

    const result = await initializeDatabasePersistence({}, { eventBus, repository })

    expect(result.eventType).toBe(DATABASE_PERSISTENCE_INITIALIZED_EVENT)
    expect(result.status).toBe('ready')
    expect(result.parameterizedQueriesEnforced).toBe(true)
    expect(result.repositoryStores).toContain('workspaceConfigurations')
    expect(events[0]).toBe(result)
  })

  it('creates local/test-safe repository stores without a live database connection', async () => {
    const repository = createPostgresRepository({ database: createDatabaseAdapter({ client: { connected: false } }) })

    await expect(repository.getStore('workspaceConfigurations').list()).resolves.toEqual([])
    await expect(repository.getStore('workspaceConfigurations').upsert('workspace-1', { paperTrading: true })).resolves.toMatchObject({
      ok: true,
      disabled: true,
    })
  })
})

describe('Phase 26B Netlify Functions API foundation', () => {
  it('returns database health with standard API envelope and request id', async () => {
    const repository = createMockRepository()
    const handler = createDatabaseHealthHandler({
      repositoryFactory: () => repository,
      env: { TRADING_MODE: 'paper' },
    })

    const response = parseResponse(await handler({ httpMethod: 'GET', headers: { 'x-request-id': 'req-db-health' } }))

    expect(response.statusCode).toBe(200)
    expect(response.headers['x-request-id']).toBe('req-db-health')
    expect(response.json.data.health.status).toBe('healthy')
    expect(response.json.data.event.eventType).toBe('system.apiFoundation.initialized')
    expect(repository.end).toHaveBeenCalled()
  })

  it('reads and writes workspace configurations with sanitized inputs', async () => {
    const repository = createMockRepository({ workspaceConfigurations: [{ id: 'workspace-1', payload: { density: 'operator' } }] })
    const handler = createWorkspaceConfigurationsHandler({
      repositoryFactory: () => repository,
      env: { TRADING_MODE: 'paper' },
    })

    const write = parseResponse(await handler(jsonEvent({ id: 'workspace-1', payload: { density: 'operator' } })))
    const read = parseResponse(await handler({ httpMethod: 'GET', queryStringParameters: { limit: '10' } }))

    expect(write.statusCode).toBe(200)
    expect(write.json.data.result.data.payload.density).toBe('operator')
    expect(read.json.data.workspaceConfigurations[0].id).toBe('workspace-1')
    expect(repository.getStore('workspaceConfigurations').upsert).toHaveBeenCalledWith('workspace-1', { density: 'operator' })
  })

  it('rejects unsafe workspace configuration ids with safe public errors', async () => {
    const handler = createWorkspaceConfigurationsHandler({
      repositoryFactory: () => createMockRepository(),
      env: { TRADING_MODE: 'paper' },
    })
    const response = parseResponse(await handler(jsonEvent({ id: '../secret', payload: {} })))

    expect(response.statusCode).toBe(400)
    expect(response.json.error).toMatchObject({
      code: 'validation_error',
      message: 'id is invalid',
      requestId: 'req-phase26',
    })
  })

  it('reads system events and operator actions without trading or broker endpoints', async () => {
    const repository = createMockRepository({
      systemEvents: [{ id: 'evt-1', payload: { eventType: 'system.test' } }],
      operatorActions: [{ id: 'act-1', payload: { status: 'open' } }],
    })
    const systemEvents = createSystemEventsHandler({ repositoryFactory: () => repository, env: { TRADING_MODE: 'paper' } })
    const operatorActions = createOperatorActionsHandler({ repositoryFactory: () => repository, env: { TRADING_MODE: 'paper' } })

    const eventResponse = parseResponse(await systemEvents({ httpMethod: 'GET' }))
    const actionResponse = parseResponse(await operatorActions({ httpMethod: 'GET' }))

    expect(eventResponse.json.data.systemEvents[0].id).toBe('evt-1')
    expect(actionResponse.json.data.operatorActions[0].id).toBe('act-1')
    expect(eventResponse.json.data.paperTrading).toBe(true)
    expect(actionResponse.json.data.event.brokerExecution).toBe(false)
  })
})

describe('Phase 26C persistence and API integration validation', () => {
  it('evaluates ready persistence/API integration from database and API foundation outputs', () => {
    const result = evaluatePersistenceApiIntegration({
      databasePersistence: {
        eventType: 'system.databasePersistence.initialized',
        status: 'ready',
        migrationSummary: { ok: true, applied: ['phase26'], skipped: [] },
        repositoryStores: ['workspaceConfigurations', 'systemEvents'],
        parameterizedQueriesEnforced: true,
        transactionHelperAvailable: true,
        databaseHealthCheck: { status: 'healthy', connected: true },
      },
      apiFoundation: {
        eventType: 'system.apiFoundation.initialized',
        status: 'ready',
      },
    }, { emitEvent: false })

    expect(result.eventType).toBe(SYSTEM_PERSISTENCE_API_INTEGRATION_EVALUATED_EVENT)
    expect(result.persistenceReadinessStatus).toBe('ready')
    expect(result.repositoryContractValidation.parameterizedQueriesEnforced).toBe(true)
    expect(result.functionHandlerValidation.noTradingEndpoints).toBe(true)
    expect(result.degradedModeHandling.localWorkspaceFallback).toBe(true)
  })

  it('blocks integration when repository contracts fail', () => {
    const result = evaluatePersistenceApiIntegration({
      databasePersistence: {
        status: 'ready',
        migrationSummary: { ok: true },
        parameterizedQueriesEnforced: false,
        transactionHelperAvailable: true,
      },
      apiFoundation: { status: 'ready' },
    }, { emitEvent: false })

    expect(result.persistenceReadinessStatus).toBe('blocked')
    expect(result.repositoryContractValidation.status).toBe('blocked')
  })

  it('emits persistence API integration events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(SYSTEM_PERSISTENCE_API_INTEGRATION_EVALUATED_EVENT, (payload) => events.push(payload))

    const result = createPersistenceApiIntegrationEngine({ eventBus }).evaluate({
      databasePersistence: {
        status: 'ready',
        migrationSummary: { ok: true },
        parameterizedQueriesEnforced: true,
        transactionHelperAvailable: true,
      },
      apiFoundation: { status: 'ready' },
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
  })
})
