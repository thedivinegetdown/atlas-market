import { ERROR_CODES } from '../errors/appError.js'
import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_API_RELIABILITY_EVALUATED_EVENT = 'system.apiReliability.evaluated'

export const API_ROUTE_REGISTRY = Object.freeze([
  Object.freeze({
    id: 'database-health',
    path: '/.netlify/functions/database-health',
    methods: Object.freeze(['GET']),
    collection: false,
    writeEndpoint: false,
  }),
  Object.freeze({
    id: 'workspace-configurations',
    path: '/.netlify/functions/workspace-configurations',
    methods: Object.freeze(['GET', 'POST']),
    collection: true,
    writeEndpoint: true,
  }),
  Object.freeze({
    id: 'system-events',
    path: '/.netlify/functions/system-events',
    methods: Object.freeze(['GET']),
    collection: true,
    writeEndpoint: false,
  }),
  Object.freeze({
    id: 'operator-actions',
    path: '/.netlify/functions/operator-actions',
    methods: Object.freeze(['GET']),
    collection: true,
    writeEndpoint: false,
  }),
  Object.freeze({
    id: 'session-status',
    path: '/.netlify/functions/session-status',
    methods: Object.freeze(['GET']),
    collection: false,
    writeEndpoint: false,
    authenticated: true,
  }),
  Object.freeze({
    id: 'current-user',
    path: '/.netlify/functions/current-user',
    methods: Object.freeze(['GET']),
    collection: false,
    writeEndpoint: false,
    authenticated: true,
  }),
  Object.freeze({
    id: 'session-revoke',
    path: '/.netlify/functions/session-revoke',
    methods: Object.freeze(['POST']),
    collection: false,
    writeEndpoint: true,
    authenticated: true,
  }),
  Object.freeze({
    id: 'protected-workspace-configurations',
    path: '/.netlify/functions/protected-workspace-configurations',
    methods: Object.freeze(['GET', 'POST']),
    collection: true,
    writeEndpoint: true,
    authenticated: true,
  }),
  Object.freeze({
    id: 'authorization-health',
    path: '/.netlify/functions/authorization-health',
    methods: Object.freeze(['GET']),
    collection: false,
    writeEndpoint: false,
    authenticated: true,
  }),
  Object.freeze({
    id: 'current-organization',
    path: '/.netlify/functions/current-organization',
    methods: Object.freeze(['GET']),
    collection: false,
    writeEndpoint: false,
    authenticated: true,
  }),
  Object.freeze({
    id: 'organization-memberships',
    path: '/.netlify/functions/organization-memberships',
    methods: Object.freeze(['GET', 'POST']),
    collection: true,
    writeEndpoint: true,
    authenticated: true,
  }),
  Object.freeze({
    id: 'protected-organization-workspace-configurations',
    path: '/.netlify/functions/protected-organization-workspace-configurations',
    methods: Object.freeze(['GET', 'POST']),
    collection: true,
    writeEndpoint: true,
    authenticated: true,
  }),
  Object.freeze({
    id: 'organization-authorization-health',
    path: '/.netlify/functions/organization-authorization-health',
    methods: Object.freeze(['GET']),
    collection: false,
    writeEndpoint: false,
    authenticated: true,
  }),
  Object.freeze({
    id: 'organization-invitations',
    path: '/.netlify/functions/organization-invitations',
    methods: Object.freeze(['GET', 'POST']),
    collection: true,
    writeEndpoint: true,
    authenticated: true,
  }),
  Object.freeze({
    id: 'team-workspace-invitations',
    path: '/.netlify/functions/team-workspace-invitations',
    methods: Object.freeze(['GET', 'POST']),
    collection: true,
    writeEndpoint: true,
    authenticated: true,
  }),
  Object.freeze({
    id: 'invitation-acceptance',
    path: '/.netlify/functions/invitation-acceptance',
    methods: Object.freeze(['POST']),
    collection: false,
    writeEndpoint: true,
    authenticated: true,
  }),
  Object.freeze({
    id: 'invitation-revocation',
    path: '/.netlify/functions/invitation-revocation',
    methods: Object.freeze(['POST']),
    collection: false,
    writeEndpoint: true,
    authenticated: true,
  }),
  Object.freeze({
    id: 'current-team-workspace',
    path: '/.netlify/functions/current-team-workspace',
    methods: Object.freeze(['GET']),
    collection: false,
    writeEndpoint: false,
    authenticated: true,
  }),
  Object.freeze({
    id: 'team-workspace-memberships',
    path: '/.netlify/functions/team-workspace-memberships',
    methods: Object.freeze(['GET', 'POST']),
    collection: true,
    writeEndpoint: true,
    authenticated: true,
  }),
  Object.freeze({
    id: 'protected-team-workspace-configurations',
    path: '/.netlify/functions/protected-team-workspace-configurations',
    methods: Object.freeze(['GET', 'POST']),
    collection: true,
    writeEndpoint: true,
    authenticated: true,
  }),
  Object.freeze({
    id: 'collaboration-health',
    path: '/.netlify/functions/collaboration-health',
    methods: Object.freeze(['GET']),
    collection: false,
    writeEndpoint: false,
    authenticated: true,
  }),
  Object.freeze({
    id: 'organization-administration',
    path: '/.netlify/functions/organization-administration',
    methods: Object.freeze(['POST']),
    collection: false,
    writeEndpoint: true,
    authenticated: true,
  }),
  Object.freeze({
    id: 'team-workspace-administration',
    path: '/.netlify/functions/team-workspace-administration',
    methods: Object.freeze(['POST']),
    collection: false,
    writeEndpoint: true,
    authenticated: true,
  }),
  Object.freeze({
    id: 'membership-role-management',
    path: '/.netlify/functions/membership-role-management',
    methods: Object.freeze(['POST']),
    collection: false,
    writeEndpoint: true,
    authenticated: true,
  }),
  Object.freeze({
    id: 'membership-status-management',
    path: '/.netlify/functions/membership-status-management',
    methods: Object.freeze(['POST']),
    collection: false,
    writeEndpoint: true,
    authenticated: true,
  }),
  Object.freeze({
    id: 'active-sessions',
    path: '/.netlify/functions/active-sessions',
    methods: Object.freeze(['GET']),
    collection: true,
    writeEndpoint: false,
    authenticated: true,
  }),
  Object.freeze({
    id: 'revoke-selected-session',
    path: '/.netlify/functions/revoke-selected-session',
    methods: Object.freeze(['POST']),
    collection: false,
    writeEndpoint: true,
    authenticated: true,
  }),
  Object.freeze({
    id: 'revoke-other-sessions',
    path: '/.netlify/functions/revoke-other-sessions',
    methods: Object.freeze(['POST']),
    collection: false,
    writeEndpoint: true,
    authenticated: true,
  }),
  Object.freeze({
    id: 'session-security-health',
    path: '/.netlify/functions/session-security-health',
    methods: Object.freeze(['GET']),
    collection: false,
    writeEndpoint: false,
    authenticated: true,
  }),
  Object.freeze({
    id: 'administrative-audit',
    path: '/.netlify/functions/administrative-audit',
    methods: Object.freeze(['GET']),
    collection: true,
    writeEndpoint: false,
    authenticated: true,
  }),
  Object.freeze({
    id: 'tenant-operations-health',
    path: '/.netlify/functions/tenant-operations-health',
    methods: Object.freeze(['GET']),
    collection: false,
    writeEndpoint: false,
    authenticated: true,
  }),
  Object.freeze({
    id: 'tenant-backup-recovery-plan',
    path: '/.netlify/functions/tenant-backup-recovery-plan',
    methods: Object.freeze(['GET']),
    collection: false,
    writeEndpoint: false,
    authenticated: true,
  }),
  Object.freeze({
    id: 'access-certification',
    path: '/.netlify/functions/access-certification',
    methods: Object.freeze(['GET']),
    collection: false,
    writeEndpoint: false,
    authenticated: true,
  }),
  Object.freeze({
    id: 'current-account',
    path: '/.netlify/functions/current-account',
    methods: Object.freeze(['GET']),
    collection: false,
    writeEndpoint: false,
    authenticated: true,
  }),
  Object.freeze({
    id: 'account-profile-update',
    path: '/.netlify/functions/account-profile-update',
    methods: Object.freeze(['POST']),
    collection: false,
    writeEndpoint: true,
    authenticated: true,
  }),
  Object.freeze({
    id: 'account-health',
    path: '/.netlify/functions/account-health',
    methods: Object.freeze(['GET']),
    collection: false,
    writeEndpoint: false,
    authenticated: true,
  }),
  Object.freeze({
    id: 'notification-preferences',
    path: '/.netlify/functions/notification-preferences',
    methods: Object.freeze(['GET']),
    collection: false,
    writeEndpoint: false,
    authenticated: true,
  }),
  Object.freeze({
    id: 'notification-preferences-update',
    path: '/.netlify/functions/notification-preferences-update',
    methods: Object.freeze(['POST']),
    collection: false,
    writeEndpoint: true,
    authenticated: true,
  }),
  Object.freeze({
    id: 'in-app-notifications',
    path: '/.netlify/functions/in-app-notifications',
    methods: Object.freeze(['GET', 'POST']),
    collection: true,
    writeEndpoint: true,
    authenticated: true,
  }),
  Object.freeze({
    id: 'notification-status-update',
    path: '/.netlify/functions/notification-status-update',
    methods: Object.freeze(['POST']),
    collection: false,
    writeEndpoint: true,
    authenticated: true,
  }),
  Object.freeze({
    id: 'notification-center-health',
    path: '/.netlify/functions/notification-center-health',
    methods: Object.freeze(['GET']),
    collection: false,
    writeEndpoint: false,
    authenticated: true,
  }),
  Object.freeze({
    id: 'current-user-activity',
    path: '/.netlify/functions/current-user-activity',
    methods: Object.freeze(['GET']),
    collection: true,
    writeEndpoint: false,
    authenticated: true,
  }),
  Object.freeze({
    id: 'tenant-administrative-activity',
    path: '/.netlify/functions/tenant-administrative-activity',
    methods: Object.freeze(['GET']),
    collection: true,
    writeEndpoint: false,
    authenticated: true,
  }),
  Object.freeze({
    id: 'tenant-administration-workflows',
    path: '/.netlify/functions/tenant-administration-workflows',
    methods: Object.freeze(['GET']),
    collection: true,
    writeEndpoint: false,
    authenticated: true,
  }),
  Object.freeze({
    id: 'workflow-status-update',
    path: '/.netlify/functions/workflow-status-update',
    methods: Object.freeze(['POST']),
    collection: false,
    writeEndpoint: true,
    authenticated: true,
  }),
  Object.freeze({
    id: 'administration-workflow-health',
    path: '/.netlify/functions/administration-workflow-health',
    methods: Object.freeze(['GET']),
    collection: false,
    writeEndpoint: false,
    authenticated: true,
  }),
  Object.freeze({
    id: 'notification-digest',
    path: '/.netlify/functions/notification-digest',
    methods: Object.freeze(['GET']),
    collection: false,
    writeEndpoint: false,
    authenticated: true,
  }),
  Object.freeze({
    id: 'user-activity-risk-review',
    path: '/.netlify/functions/user-activity-risk-review',
    methods: Object.freeze(['GET']),
    collection: false,
    writeEndpoint: false,
    authenticated: true,
  }),
  Object.freeze({
    id: 'workflow-sla-review',
    path: '/.netlify/functions/workflow-sla-review',
    methods: Object.freeze(['GET']),
    collection: false,
    writeEndpoint: false,
    authenticated: true,
  }),
  Object.freeze({
    id: 'operator-attention-queue',
    path: '/.netlify/functions/operator-attention-queue',
    methods: Object.freeze(['GET']),
    collection: true,
    writeEndpoint: false,
    authenticated: true,
  }),
  Object.freeze({
    id: 'administrative-cases',
    path: '/.netlify/functions/administrative-cases',
    methods: Object.freeze(['GET', 'POST']),
    collection: true,
    writeEndpoint: true,
    authenticated: true,
  }),
  Object.freeze({
    id: 'administrative-case-detail',
    path: '/.netlify/functions/administrative-case-detail',
    methods: Object.freeze(['GET']),
    collection: false,
    writeEndpoint: false,
    authenticated: true,
  }),
  Object.freeze({
    id: 'administrative-case-status-update',
    path: '/.netlify/functions/administrative-case-status-update',
    methods: Object.freeze(['POST']),
    collection: false,
    writeEndpoint: true,
    authenticated: true,
  }),
  Object.freeze({
    id: 'operator-intelligence-health',
    path: '/.netlify/functions/operator-intelligence-health',
    methods: Object.freeze(['GET']),
    collection: false,
    writeEndpoint: false,
    authenticated: true,
  }),
  Object.freeze({
    id: 'administrative-evidence',
    path: '/.netlify/functions/administrative-evidence',
    methods: Object.freeze(['GET', 'POST']),
    collection: true,
    writeEndpoint: true,
    authenticated: true,
  }),
  Object.freeze({
    id: 'administrative-evidence-detail',
    path: '/.netlify/functions/administrative-evidence-detail',
    methods: Object.freeze(['GET']),
    collection: false,
    writeEndpoint: false,
    authenticated: true,
  }),
  Object.freeze({
    id: 'evidence-review-status-update',
    path: '/.netlify/functions/evidence-review-status-update',
    methods: Object.freeze(['POST']),
    collection: false,
    writeEndpoint: true,
    authenticated: true,
  }),
  Object.freeze({
    id: 'remediation-plans',
    path: '/.netlify/functions/remediation-plans',
    methods: Object.freeze(['GET', 'POST']),
    collection: true,
    writeEndpoint: true,
    authenticated: true,
  }),
  Object.freeze({
    id: 'remediation-plan-detail',
    path: '/.netlify/functions/remediation-plan-detail',
    methods: Object.freeze(['GET']),
    collection: false,
    writeEndpoint: false,
    authenticated: true,
  }),
  Object.freeze({
    id: 'remediation-plan-approval-update',
    path: '/.netlify/functions/remediation-plan-approval-update',
    methods: Object.freeze(['POST']),
    collection: false,
    writeEndpoint: true,
    authenticated: true,
  }),
  Object.freeze({
    id: 'remediation-plan-status-update',
    path: '/.netlify/functions/remediation-plan-status-update',
    methods: Object.freeze(['POST']),
    collection: false,
    writeEndpoint: true,
    authenticated: true,
  }),
  Object.freeze({
    id: 'investigation-remediation-health',
    path: '/.netlify/functions/investigation-remediation-health',
    methods: Object.freeze(['GET']),
    collection: false,
    writeEndpoint: false,
    authenticated: true,
  }),
])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function normalizeStatus(status) {
  if (['blocked', 'invalid', 'degraded', 'failed', 'critical'].includes(status)) return 'blocked'
  if (['ready', 'healthy', 'valid', 'passed', 'available'].includes(status)) return 'ready'
  return 'caution'
}

function resolveStatus(sections) {
  if (sections.some((section) => section.status === 'blocked')) return 'blocked'
  if (sections.some((section) => section.status === 'caution')) return 'caution'
  return 'ready'
}

function section(id, label, sourceStatus, details = {}) {
  return {
    id,
    label,
    status: normalizeStatus(sourceStatus),
    sourceStatus: sourceStatus ?? 'unknown',
    ...details,
  }
}

function buildRouteRegistry(apiFoundation = {}) {
  const knownEndpoints = new Set(apiFoundation.endpoints ?? API_ROUTE_REGISTRY.map((route) => route.id))
  return API_ROUTE_REGISTRY.map((route) => ({
    ...route,
    registered: knownEndpoints.has(route.id),
    authenticated: route.authenticated === true,
    safeForPaperMode: true,
    tradingEndpoint: false,
    brokerExecutionEndpoint: false,
  }))
}

export function evaluateApiReliability(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const apiFoundation = input.apiFoundation ?? {}
  const persistenceIntegration = input.persistenceApiIntegration ?? {}
  const databaseOperations = input.databaseOperations ?? {}
  const routes = buildRouteRegistry(apiFoundation)
  const missingRoutes = routes.filter((route) => !route.registered)

  const apiRouteRegistry = section(
    'api-route-registry',
    'API route registry',
    missingRoutes.length === 0 ? 'ready' : 'blocked',
    {
      routes,
      routeCount: routes.length,
      noLiveTradingRoutes: routes.every((route) => route.tradingEndpoint === false),
      noBrokerExecutionRoutes: routes.every((route) => route.brokerExecutionEndpoint === false),
    },
  )
  const requestResponseContractValidation = section(
    'request-response-contract-validation',
    'Request / response contract validation',
    apiFoundation.status ?? 'ready',
    {
      successEnvelope: '{ ok: true, data }',
      errorEnvelope: '{ ok: false, error: { code, message, requestId } }',
      requestIdHeader: 'x-request-id',
      safePublicErrors: true,
      corsSecurityHeaders: true,
    },
  )
  const paginationContract = section(
    'pagination-contract',
    'Pagination contract',
    'ready',
    {
      collectionEndpoints: routes.filter((route) => route.collection).map((route) => route.id),
      limitParameter: 'limit',
      defaultLimit: 50,
      maxLimit: 100,
      offsetPaginationDeferred: true,
    },
  )
  const safeFilteringAndSortingBoundaries = section(
    'safe-filtering-sorting-boundaries',
    'Safe filtering and sorting boundaries',
    'ready',
    {
      allowedFilterFields: ['id', 'event_type', 'status', 'severity'],
      allowedSortFields: ['created_at', 'updated_at'],
      sanitizedIds: true,
      parameterizedQueriesRequired: true,
    },
  )
  const rateLimitReadinessPlaceholder = section(
    'rate-limit-readiness-placeholder',
    'Rate-limit readiness placeholder',
    'ready',
    {
      boundary: 'shared Netlify API handler',
      defaultLimiterAvailable: true,
      futurePerRoutePolicies: true,
      enforcementWithoutAuthentication: 'client-key throttle',
    },
  )
  const idempotencyKeyReadiness = section(
    'idempotency-key-readiness',
    'Idempotency-key readiness',
    'ready',
    {
      futureHeader: 'idempotency-key',
      writeEndpoints: routes.filter((route) => route.writeEndpoint).map((route) => route.id),
      currentWriteBehavior: 'safe upsert by sanitized id',
      noTradingWrites: true,
    },
  )
  const structuredErrorCodeCatalog = section(
    'structured-error-code-catalog',
    'Structured error code catalog',
    'ready',
    {
      codes: Object.values(ERROR_CODES),
      persistenceCodes: ['database_operation_failed', 'database_initialization_failed'],
      publicErrorsOnly: true,
    },
  )
  const apiHealthAggregation = section(
    'api-health-aggregation',
    'API health aggregation',
    persistenceIntegration.persistenceReadinessStatus === 'blocked' || databaseOperations.databaseOperationsStatus === 'blocked'
      ? 'blocked'
      : 'ready',
    {
      apiFoundationStatus: apiFoundation.status ?? 'ready',
      persistenceReadinessStatus: persistenceIntegration.persistenceReadinessStatus ?? 'unknown',
      databaseOperationsStatus: databaseOperations.databaseOperationsStatus ?? 'unknown',
      monitoringSource: input.productionMonitoringPlan?.eventType ?? null,
    },
  )

  const sections = [
    apiRouteRegistry,
    requestResponseContractValidation,
    paginationContract,
    safeFilteringAndSortingBoundaries,
    rateLimitReadinessPlaceholder,
    idempotencyKeyReadiness,
    structuredErrorCodeCatalog,
    apiHealthAggregation,
  ]
  const apiReliabilityStatus = resolveStatus(sections)
  const result = {
    eventType: SYSTEM_API_RELIABILITY_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    authenticationEnforced: false,
    secretsExposed: false,
    apiRouteRegistry,
    requestResponseContractValidation,
    paginationContract,
    safeFilteringAndSortingBoundaries,
    rateLimitReadinessPlaceholder,
    idempotencyKeyReadiness,
    structuredErrorCodeCatalog,
    apiHealthAggregation,
    apiReliabilityStatus,
    summary: `API reliability ${apiReliabilityStatus}: route registry, envelopes, pagination, filtering, rate-limit readiness, idempotency planning, errors, and health aggregation reviewed.`,
    sourceEvents: {
      apiFoundation: apiFoundation.eventType ?? null,
      persistenceApiIntegration: persistenceIntegration.eventType ?? null,
      databaseOperations: databaseOperations.eventType ?? null,
      productionMonitoringPlan: input.productionMonitoringPlan?.eventType ?? null,
      eventObservability: input.eventObservability?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(SYSTEM_API_RELIABILITY_EVALUATED_EVENT, result)
  }
  return result
}

export function createApiReliabilityEngine(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return evaluateApiReliability(input, { ...options, ...evaluationOptions })
    },
  }
}
