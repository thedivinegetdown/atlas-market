import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_CONTROL_TESTING_EVALUATED_EVENT = 'system.controlTesting.evaluated'

export const TEST_STATUSES = Object.freeze(['not_started', 'in_progress', 'passed', 'failed', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return TEST_STATUSES.includes(status) ? status : 'not_started'
}

function normalizeReference(reference = {}) {
  return {
    id: reference.id ?? reference.controlId ?? null,
    type: reference.type ?? 'reference',
    eventType: reference.eventType ?? null,
  }
}

export function normalizeControlTest(input = {}) {
  const now = input.evaluatedAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `control-test-${input.controlId ?? Date.now()}`),
    controlId: input.controlId ?? null,
    policyId: input.policyId ?? input.relatedPolicyId ?? null,
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    testStatus: safeStatus(input.testStatus ?? input.status),
    testObjective: String(input.testObjective ?? 'Validate administrative control evidence and exception state.').slice(0, 240),
    testMethod: input.testMethod ?? 'documented-evidence-review',
    evidenceReferences: (input.evidenceReferences ?? []).map(normalizeReference),
    exceptionReferences: (input.exceptionReferences ?? []).map(normalizeReference),
    findingSummary: String(input.findingSummary ?? 'Control test requires human review before assurance decisions.').slice(0, 500),
    testedByUserId: input.testedByUserId ?? tenantScope.userId ?? null,
    nextTestDueAt: input.nextTestDueAt ?? null,
    confidence: Math.min(1, Math.max(0, Number(input.confidence ?? 0.76))),
    evaluatedAt: now,
    humanReviewOnly: true,
    automaticFindingResolution: false,
    automaticEnforcementActions: false,
    sensitiveMaterialExcluded: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createControlTestingRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(testInput) {
      const test = normalizeControlTest(testInput)
      if (!database?.connected) return { ok: true, disabled: true, test }
      const result = await database.query(
        `INSERT INTO atlas_control_tests
          (id, organization_id, team_workspace_id, policy_id, control_id, test_status, next_test_due_at, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET test_status = EXCLUDED.test_status, next_test_due_at = EXCLUDED.next_test_due_at, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [test.id, test.tenantScope.organizationId, test.tenantScope.teamWorkspaceId, test.policyId, test.controlId, test.testStatus, test.nextTestDueAt, test],
      )
      return { ok: true, test: normalizeControlTest(result.rows?.[0]?.payload ?? test) }
    },
    async list({ tenantContext = {}, testStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (testStatus) {
        params.push(safeStatus(testStatus))
        clauses.push(`test_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_control_tests
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeControlTest(row.payload))
    },
  }
}

export function evaluateControlTesting(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const now = options.timestamp ?? getNowIso()
  const evaluations = input.controlAssurance?.controlAssuranceEvaluations ?? []
  const supplied = input.controlTests ?? []
  const tests = supplied.length
    ? supplied.map(normalizeControlTest)
    : evaluations.map((control) => normalizeControlTest({
      tenantContext: control.tenantScope,
      controlId: control.controlId,
      policyId: control.relatedPolicyId,
      testStatus: control.controlStatus === 'effective' ? 'passed' : control.controlStatus === 'ineffective' ? 'failed' : 'in_progress',
      evidenceReferences: control.auditReferences,
      exceptionReferences: control.exceptionCount > 0 ? [{ id: control.controlId, type: 'policy-exception' }] : [],
      confidence: control.confidence,
      timestamp: now,
    }))
  const summary = {
    total: tests.length,
    passed: tests.filter((item) => item.testStatus === 'passed').length,
    failed: tests.filter((item) => item.testStatus === 'failed').length,
    blocked: tests.filter((item) => item.testStatus === 'blocked').length,
    inProgress: tests.filter((item) => item.testStatus === 'in_progress').length,
    notStarted: tests.filter((item) => item.testStatus === 'not_started').length,
  }
  const testingStatus = summary.failed > 0 || summary.blocked > 0 ? 'blocked' : summary.inProgress > 0 || summary.notStarted > 0 ? 'caution' : 'healthy'
  const result = {
    eventType: SYSTEM_CONTROL_TESTING_EVALUATED_EVENT,
    timestamp: now,
    controlTests: tests,
    testingSummary: summary,
    testingStatus,
    humanReviewOnly: true,
    automaticFindingResolution: false,
    automaticEnforcementActions: false,
    safeSummariesOnly: true,
    sensitiveMaterialExcluded: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Control testing ${testingStatus}: ${summary.passed} passed, ${summary.failed} failed, and ${summary.inProgress} in progress.`,
    sourceEvents: {
      controlAssurance: input.controlAssurance?.eventType ?? null,
      policyGovernance: input.policyGovernance?.eventType ?? null,
    },
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_CONTROL_TESTING_EVALUATED_EVENT, result)
  return result
}
