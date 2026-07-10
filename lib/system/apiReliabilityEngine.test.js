import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  API_ROUTE_REGISTRY,
  SYSTEM_API_RELIABILITY_EVALUATED_EVENT,
  createApiReliabilityEngine,
  evaluateApiReliability,
} from './apiReliabilityEngine.js'

const readyInput = {
  apiFoundation: {
    eventType: 'system.apiFoundation.initialized',
    status: 'ready',
    endpoints: API_ROUTE_REGISTRY.map((route) => route.id),
  },
  persistenceApiIntegration: {
    eventType: 'system.persistenceApiIntegration.evaluated',
    persistenceReadinessStatus: 'ready',
  },
  databaseOperations: {
    eventType: 'system.databaseOperations.evaluated',
    databaseOperationsStatus: 'ready',
  },
}

describe('API reliability engine', () => {
  it('evaluates route registry, contracts, pagination, and API health aggregation', () => {
    const result = evaluateApiReliability(readyInput, { emitEvent: false })

    expect(result.eventType).toBe(SYSTEM_API_RELIABILITY_EVALUATED_EVENT)
    expect(result.apiReliabilityStatus).toBe('ready')
    expect(result.apiRouteRegistry.routeCount).toBe(API_ROUTE_REGISTRY.length)
    expect(result.apiRouteRegistry.noLiveTradingRoutes).toBe(true)
    expect(result.apiRouteRegistry.noBrokerExecutionRoutes).toBe(true)
    expect(result.requestResponseContractValidation.requestIdHeader).toBe('x-request-id')
    expect(result.paginationContract.maxLimit).toBe(100)
    expect(result.safeFilteringAndSortingBoundaries.parameterizedQueriesRequired).toBe(true)
    expect(result.rateLimitReadinessPlaceholder.futurePerRoutePolicies).toBe(true)
    expect(result.idempotencyKeyReadiness.futureHeader).toBe('idempotency-key')
    expect(result.structuredErrorCodeCatalog.publicErrorsOnly).toBe(true)
    expect(result.paperTrading).toBe(true)
    expect(result.liveOrders).toBe(false)
    expect(result.brokerExecution).toBe(false)
    expect(result.authenticationEnforced).toBe(false)
    expect(result.secretsExposed).toBe(false)
  })

  it('blocks reliability when required routes are missing', () => {
    const result = evaluateApiReliability({
      ...readyInput,
      apiFoundation: {
        ...readyInput.apiFoundation,
        endpoints: ['database-health'],
      },
    }, { emitEvent: false })

    expect(result.apiReliabilityStatus).toBe('blocked')
    expect(result.apiRouteRegistry.routes.filter((route) => !route.registered).map((route) => route.id)).toEqual(expect.arrayContaining([
      'workspace-configurations',
      'system-events',
      'operator-actions',
      'session-status',
      'current-user',
      'session-revoke',
      'protected-workspace-configurations',
      'authorization-health',
      'current-organization',
      'organization-memberships',
      'protected-organization-workspace-configurations',
      'organization-authorization-health',
      'organization-invitations',
      'team-workspace-invitations',
      'invitation-acceptance',
      'invitation-revocation',
      'current-team-workspace',
      'team-workspace-memberships',
      'protected-team-workspace-configurations',
      'collaboration-health',
    ]))
  })

  it('blocks API health aggregation when persistence is blocked', () => {
    const result = evaluateApiReliability({
      ...readyInput,
      persistenceApiIntegration: {
        eventType: 'system.persistenceApiIntegration.evaluated',
        persistenceReadinessStatus: 'blocked',
      },
    }, { emitEvent: false })

    expect(result.apiReliabilityStatus).toBe('blocked')
    expect(result.apiHealthAggregation.status).toBe('blocked')
  })

  it('emits API reliability events through the engine factory', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(SYSTEM_API_RELIABILITY_EVALUATED_EVENT, (payload) => events.push(payload))

    const result = createApiReliabilityEngine({ eventBus }).evaluate(readyInput)

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
  })
})
