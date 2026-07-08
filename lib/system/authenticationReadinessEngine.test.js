import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  SYSTEM_AUTH_READINESS_EVALUATED_EVENT,
  createAuthenticationReadinessEngine,
  evaluateAuthenticationReadiness,
} from './authenticationReadinessEngine.js'

const baseInput = Object.freeze({
  workspacePersistence: Object.freeze({
    eventType: 'workspace.persistence.prepared',
    persistenceStatus: 'prepared',
    workspacePersistenceModel: Object.freeze({ workspaceId: 'atlas-paper-workspace' }),
  }),
  workspaceSessionRecovery: Object.freeze({
    eventType: 'workspace.session.recovered',
    recoveryValidationStatus: 'restored',
    savedWorkspaceStateHydration: Object.freeze({ source: 'prepared-persistence' }),
  }),
  workspaceCommandPalette: Object.freeze({
    eventType: 'workspace.commandPalette.executed',
    commandExecutionResult: Object.freeze({ commandId: 'open-enterprise-release-control' }),
    commandSafetyClassification: Object.freeze({
      safeWorkspaceCommands: 64,
      blockedTradingCommands: 0,
      workspaceActionsOnly: true,
    }),
  }),
  systemHealthCommandCenter: Object.freeze({
    eventType: 'system.healthCommandCenter.evaluated',
    finalPlatformHealthStatus: 'operational',
  }),
  enterpriseReleaseControl: Object.freeze({
    eventType: 'system.releaseControl.evaluated',
    finalReleaseStatus: 'release-ready',
  }),
})

describe('authentication readiness engine', () => {
  it('evaluates ready placeholder auth boundaries for paper-mode workspace access', () => {
    const result = evaluateAuthenticationReadiness(baseInput, {
      emitEvent: false,
      timestamp: '2026-07-08T19:00:00.000Z',
    })

    expect(result.eventType).toBe(SYSTEM_AUTH_READINESS_EVALUATED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.liveOrders).toBe(false)
    expect(result.brokerageIntegration).toBe(false)
    expect(result.realAuthenticationEnabled).toBe(false)
    expect(result.signInUiEnabled).toBe(false)
    expect(result.multiUserPersistenceEnabled).toBe(false)
    expect(result.authReadinessStatus).toBe('ready')
    expect(result.futureUserIdentityModelPlaceholder.modelStatus).toBe('placeholder')
    expect(result.operatorSessionIdentityPlaceholder.authenticated).toBe(false)
    expect(result.roleModelPlaceholder.map((role) => role.role)).toEqual(['owner', 'admin', 'analyst', 'viewer'])
    expect(result.permissionBoundarySummary.allowedScopes).toContain('workspace.navigation')
    expect(result.permissionBoundarySummary.deniedScopes).toContain('broker.order.create')
    expect(result.paperModeAccessBoundary.commandPaletteWorkspaceOnly).toBe(true)
    expect(result.sourceEvents.workspaceCommandPalette).toBe('workspace.commandPalette.executed')
  })

  it('returns caution when recovery or release context needs review', () => {
    const result = evaluateAuthenticationReadiness({
      ...baseInput,
      workspaceSessionRecovery: {
        ...baseInput.workspaceSessionRecovery,
        recoveryValidationStatus: 'failed',
      },
      enterpriseReleaseControl: {
        ...baseInput.enterpriseReleaseControl,
        finalReleaseStatus: 'blocked',
      },
    }, { emitEvent: false })

    expect(result.authReadinessStatus).toBe('caution')
    expect(result.paperModeAccessBoundary.sessionRecoveryStatus).toBe('failed')
    expect(result.permissionBoundarySummary.releaseReviewStatus).toBe('blocked')
  })

  it('blocks readiness if workspace commands expose trading actions', () => {
    const result = evaluateAuthenticationReadiness({
      ...baseInput,
      workspaceCommandPalette: {
        ...baseInput.workspaceCommandPalette,
        commandSafetyClassification: {
          safeWorkspaceCommands: 62,
          blockedTradingCommands: 1,
          workspaceActionsOnly: false,
        },
      },
    }, { emitEvent: false })

    expect(result.authReadinessStatus).toBe('blocked')
    expect(result.permissionBoundarySummary.blockedTradingCommandCount).toBe(1)
  })

  it('emits system auth readiness evaluated events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(SYSTEM_AUTH_READINESS_EVALUATED_EVENT, (payload) => events.push(payload))

    const result = createAuthenticationReadinessEngine({ eventBus }).evaluate(baseInput)

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0].eventType).toBe(SYSTEM_AUTH_READINESS_EVALUATED_EVENT)
  })
})
