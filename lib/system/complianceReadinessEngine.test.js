import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  SYSTEM_COMPLIANCE_READINESS_EVALUATED_EVENT,
  createComplianceReadinessEngine,
  evaluateComplianceReadiness,
} from './complianceReadinessEngine.js'

const baseInput = {
  enterpriseAuditTrail: {
    eventType: 'system.auditTrail.recorded',
    auditIntegrityStatus: { status: 'valid' },
    normalizedAuditRecords: [{ id: 'audit-1' }],
  },
  dataQualityReadiness: { eventType: 'system.dataQuality.evaluated', dataQualityStatus: 'ready' },
  dataLineage: { eventType: 'system.dataLineage.evaluated', lineageStatus: 'valid' },
  dataRetentionPlanning: { eventType: 'system.dataRetention.planned', retentionReadinessStatus: 'ready' },
  productionSecurityReadiness: {
    eventType: 'system.securityReadiness.evaluated',
    securityReadinessStatus: 'ready',
    secretsExposed: false,
    paperTradingSafetyLockSummary: { status: 'ready', liveOrders: false },
  },
  enterpriseReleaseControl: {
    eventType: 'system.releaseControl.evaluated',
    finalReleaseStatus: 'release-ready',
    liveOrders: false,
  },
  productionDeploymentReadiness: { eventType: 'system.deploymentReadiness.evaluated' },
}

describe('compliance readiness engine', () => {
  it('evaluates planning-only compliance readiness without legal claims', () => {
    const result = evaluateComplianceReadiness(baseInput, {
      emitEvent: false,
      timestamp: '2026-07-09T02:00:00.000Z',
    })

    expect(result.eventType).toBe(SYSTEM_COMPLIANCE_READINESS_EVALUATED_EVENT)
    expect(result.complianceReadinessStatus).toBe('ready')
    expect(result.paperTradingComplianceBoundarySummary.status).toBe('ready')
    expect(result.auditCompatibilitySummary.status).toBe('ready')
    expect(result.dataGovernanceCompatibilitySummary.status).toBe('ready')
    expect(result.securityReadinessCompatibilitySummary.status).toBe('ready')
    expect(result.releaseControlCompatibilitySummary.status).toBe('ready')
    expect(result.legalClaimMade).toBe(false)
    expect(result.policyEnforced).toBe(false)
    expect(result.liveOrders).toBe(false)
    expect(result.brokerExecution).toBe(false)
  })

  it('blocks compliance readiness when live-order boundaries are violated', () => {
    const result = evaluateComplianceReadiness({
      ...baseInput,
      productionSecurityReadiness: {
        ...baseInput.productionSecurityReadiness,
        paperTradingSafetyLockSummary: { status: 'blocked', liveOrders: true },
      },
    }, { emitEvent: false })

    expect(result.complianceReadinessStatus).toBe('blocked')
    expect(result.paperTradingComplianceBoundarySummary.status).toBe('blocked')
  })

  it('emits compliance readiness evaluated events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(SYSTEM_COMPLIANCE_READINESS_EVALUATED_EVENT, (payload) => events.push(payload))

    const result = createComplianceReadinessEngine({ eventBus }).evaluate(baseInput)

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
  })
})
