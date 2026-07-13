import { describe, expect, it, vi } from 'vitest'
import { buildMigrationSql, runMigrations } from '../lib/db/migrations.js'
import { createComplianceContinuousImprovementProgramRepository, evaluateComplianceContinuousImprovementProgram, SYSTEM_COMPLIANCE_CONTINUOUS_IMPROVEMENT_PROGRAM_EVALUATED_EVENT } from '../lib/system/complianceContinuousImprovementProgramEngine.js'
import { createComplianceOptimizationRoadmapRepository, planComplianceOptimizationRoadmap, SYSTEM_COMPLIANCE_OPTIMIZATION_ROADMAP_PLANNED_EVENT } from '../lib/system/complianceOptimizationRoadmapEngine.js'
import { createComplianceContinuousImprovementProgramsHandler } from '../netlify/functions/compliance-continuous-improvement-programs.js'
import { createComplianceOptimizationRoadmapsHandler } from '../netlify/functions/compliance-optimization-roadmaps.js'

const userId = 'local-development:local-operator'
const tenantContext = { organizationId: 'org-atlas-local', teamWorkspaceId: null, userId, role: 'owner' }

function parseResponse(response) {
  return { ...response, json: response.body ? JSON.parse(response.body) : null }
}

function authEvent(method = 'GET', body = {}, role = 'owner') {
  return {
    httpMethod: method,
    headers: {
      authorization: 'Bearer dev-token',
      'content-type': 'application/json',
      'x-csrf-token': 'csrf-ready',
      'x-request-id': 'req-phase51ab',
      'x-atlas-dev-role': role,
      'x-atlas-dev-subject': 'local-operator',
    },
    queryStringParameters: { organizationId: 'org-atlas-local', limit: '25' },
    body: method === 'POST' ? JSON.stringify(body) : '',
  }
}

function repositoryFactory() {
  return { connected: false, getStore: vi.fn(() => ({ listScoped: vi.fn(async () => []) })), end: vi.fn(async () => {}) }
}

function membershipRepository(role = 'owner') {
  return { getMembership: vi.fn(async () => ({ id: `membership-${role}`, organizationId: 'org-atlas-local', userId, role, status: 'active' })) }
}

function upstream() {
  const complianceBenefitRealization = { eventType: 'system.complianceBenefitRealization.summarized', benefitSummary: { averageBenefitScore: 92 } }
  const complianceImprovementOutcomeReview = { eventType: 'system.complianceImprovementOutcome.reviewed', outcomeSummary: { averageOutcomeScore: 91 } }
  const complianceProgramHealth = { eventType: 'system.complianceProgramHealth.evaluated', programHealthSummary: { averageScore: 93 } }
  const complianceBenchmarkComparison = { eventType: 'system.complianceBenchmarkComparison.evaluated', benchmarkSummary: { averageBenchmarkScore: 90 } }
  const complianceResourcePlanning = { eventType: 'system.complianceResourcePlanning.evaluated', resourceSummary: { averageResourceScore: 91 } }
  const complianceContinuousImprovementProgram = evaluateComplianceContinuousImprovementProgram({ tenantContext, complianceBenefitRealization, complianceImprovementOutcomeReview, complianceProgramHealth }, { emitEvent: false })
  const complianceOptimizationRoadmap = planComplianceOptimizationRoadmap({ tenantContext, complianceContinuousImprovementProgram, complianceBenchmarkComparison, complianceResourcePlanning }, { emitEvent: false })
  return { complianceBenefitRealization, complianceImprovementOutcomeReview, complianceProgramHealth, complianceBenchmarkComparison, complianceResourcePlanning, complianceContinuousImprovementProgram, complianceOptimizationRoadmap }
}

describe('Phase 51A compliance continuous improvement program', () => {
  it('adds idempotent continuous improvement/roadmap migrations and parameterized program access', async () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_continuous_improvement_programs')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS atlas_compliance_optimization_roadmaps')
    expect(sql).not.toContain('DROP TABLE')
    await expect(runMigrations({ connected: false })).resolves.toMatchObject({ ok: true, disabled: true })
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceContinuousImprovementProgramRepository({ database: { connected: true, query } })
    await repository.create({ id: 'program-1', tenantContext, programStatus: 'healthy', programScore: 92 })
    await repository.list({ tenantContext, programStatus: 'healthy' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('evaluates continuous improvement without program changes or remediation automation', () => {
    const source = upstream()
    expect(source.complianceContinuousImprovementProgram.eventType).toBe(SYSTEM_COMPLIANCE_CONTINUOUS_IMPROVEMENT_PROGRAM_EVALUATED_EVENT)
    expect(source.complianceContinuousImprovementProgram.automaticProgramChange).toBe(false)
    expect(source.complianceContinuousImprovementProgram.automaticRemediation).toBe(false)
  })

  it('serves continuous improvement APIs safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createComplianceContinuousImprovementProgramsHandler(options)(authEvent('GET')))
    const create = parseResponse(await createComplianceContinuousImprovementProgramsHandler(options)(authEvent('POST', { program: { id: 'program-1' } })))
    const denied = parseResponse(await createComplianceContinuousImprovementProgramsHandler({ ...options, organizationMembershipRepository: membershipRepository('viewer') })(authEvent('GET', {}, 'viewer')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.complianceContinuousImprovementProgram.automaticProgramChange).toBe(false)
    expect(create.json.data.program.automaticRemediation).toBe(false)
    expect(denied.statusCode).toBe(403)
  })
})

describe('Phase 51B compliance optimization roadmap', () => {
  it('plans optimization roadmaps without optimization, assignment, or remediation automation', async () => {
    const source = upstream()
    expect(source.complianceOptimizationRoadmap.eventType).toBe(SYSTEM_COMPLIANCE_OPTIMIZATION_ROADMAP_PLANNED_EVENT)
    expect(source.complianceOptimizationRoadmap.automaticOptimization).toBe(false)
    expect(source.complianceOptimizationRoadmap.automaticAssignment).toBe(false)
    expect(source.complianceOptimizationRoadmap.recommendationOnly).toBe(true)
    const query = vi.fn(async () => ({ rows: [] }))
    const repository = createComplianceOptimizationRoadmapRepository({ database: { connected: true, query } })
    await repository.create({ id: 'roadmap-1', tenantContext, roadmapStatus: 'ready', roadmapScore: 91 })
    await repository.list({ tenantContext, roadmapStatus: 'ready' })
    expect(query.mock.calls.every((call) => Array.isArray(call[1]))).toBe(true)
  })

  it('serves optimization roadmap APIs safely for owner/admin only', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('admin'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const read = parseResponse(await createComplianceOptimizationRoadmapsHandler(options)(authEvent('GET', {}, 'admin')))
    const create = parseResponse(await createComplianceOptimizationRoadmapsHandler(options)(authEvent('POST', { roadmap: { id: 'roadmap-1' } }, 'admin')))
    const denied = parseResponse(await createComplianceOptimizationRoadmapsHandler({ ...options, organizationMembershipRepository: membershipRepository('analyst') })(authEvent('GET', {}, 'analyst')))
    expect([read.statusCode, create.statusCode]).toEqual([200, 200])
    expect(read.json.data.complianceOptimizationRoadmap.automaticOptimization).toBe(false)
    expect(create.json.data.roadmap.automaticAssignment).toBe(false)
    expect(denied.statusCode).toBe(403)
  })

  it('keeps public responses free of sensitive materials and execution flags', async () => {
    const options = { repositoryFactory, organizationMembershipRepository: membershipRepository('owner'), ...upstream(), env: { TRADING_MODE: 'paper' } }
    const response = parseResponse(await createComplianceOptimizationRoadmapsHandler(options)(authEvent('GET')))
    expect(response.statusCode).toBe(200)
    expect(JSON.stringify(response.json)).not.toMatch(/"tokenHash"|"ipAddress"|"deviceFingerprint"|"secret"/)
    expect(response.json.data.liveOrders).toBe(false)
    expect(response.json.data.brokerExecution).toBe(false)
  })
})
