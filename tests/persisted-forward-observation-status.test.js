import { describe, expect, it, vi } from 'vitest'
import { createForwardObservationManifest, createBreakoutObservationExperimentDefinition } from '../lib/opportunities/forwardTest/forwardObservationEngine.js'
import { INDEX_PULLBACK_EXIT_POLICY_DEFINITION_FINGERPRINT, INDEX_PULLBACK_EXIT_POLICY_VERSION } from '../lib/opportunities/forwardTest/indexPullbackExitPolicy.js'
import { BREAKOUT_MOMENTUM_EXIT_POLICY_DEFINITION_FINGERPRINT, BREAKOUT_MOMENTUM_EXIT_POLICY_VERSION } from '../lib/opportunities/forwardTest/breakoutMomentumExitPolicy.js'
import { resolvePersistedForwardObservationStatuses } from '../lib/opportunities/forwardTest/persistedObservationStatus.js'

const scope = { tenantContext: { organizationId: 'org-a', teamWorkspaceId: 'team-a', userId: 'user-a' }, accountId: 'paper-a', userId: 'user-a' }
const base = { startedAt: '2026-08-27T00:00:00.000Z', regimeEngineVersion: 'market-regime-v1', tradeQualityVersion: 'trade-quality-v1', riskPolicyVersion: 'trade-guardrail-v1', startingPaperAccount: { accountId: 'paper-a', cash: 100000, buyingPower: 100000, equity: 100000 } }
const edgeManifest = () => createForwardObservationManifest({ ...base, observationId: 'edge-a', strategyVersions: { 'index-pullback-v1': '1.2.0' }, exitPolicy: { version: INDEX_PULLBACK_EXIT_POLICY_VERSION, policyFingerprint: INDEX_PULLBACK_EXIT_POLICY_DEFINITION_FINGERPRINT, deterministic: true, maximumHoldingSessions: 20, sameBarAmbiguity: 'stop_first', gapRule: 'adverse_stop_gap_fills_at_open;favorable_target_gap_capped_at_target' } })
const breakoutManifest = () => createForwardObservationManifest({ ...base, observationId: 'breakout-a', experimentDefinition: createBreakoutObservationExperimentDefinition({ strategyFingerprint: 'breakout-fingerprint', createdAt: base.startedAt }), exitPolicy: { version: BREAKOUT_MOMENTUM_EXIT_POLICY_VERSION, policyFingerprint: BREAKOUT_MOMENTUM_EXIT_POLICY_DEFINITION_FINGERPRINT, deterministic: true, maximumHoldingSessions: 10, sameBarAmbiguity: 'stop_first', gapRule: 'adverse_stop_gap_fills_at_open;favorable_target_gap_capped_at_target' } })

describe('persisted forward observation statuses', () => {
  it('normalizes legacy EDGE state, preserves frozen identity, and does not mix breakout outcomes', async () => {
    const edge = edgeManifest()
    const evidenceRepository = { getForwardObservationManifest: vi.fn(async ({ experimentId }) => experimentId === 'EDGE.2' ? { manifest: edge, status: 'collecting' } : null), listForwardEvidenceSnapshots: vi.fn(async () => [{ timestamp: base.startedAt, quoteFreshness: 'LIVE', provider: 'twelvedata' }]) }
    const statuses = await resolvePersistedForwardObservationStatuses({ ...scope, evidenceRepository, ledgerRepository: { listExecutions: vi.fn(async () => [{ experimentId: 'EDGE.2', exitAttribution: {} }, { experimentId: 'BREAKOUT.1', exitAttribution: {} }]) } })
    expect(evidenceRepository.getForwardObservationManifest).toHaveBeenCalledWith(expect.objectContaining({ ...scope, experimentId: 'EDGE.2' }))
    expect(statuses[0]).toMatchObject({ experimentId: 'EDGE.2', strategyId: 'index-pullback-v1', exitPolicyFingerprint: INDEX_PULLBACK_EXIT_POLICY_DEFINITION_FINGERPRINT, completedOutcomes: 1 })
    expect(statuses[1]).toMatchObject({ experimentId: 'BREAKOUT.1', status: 'NOT_STARTED', completedOutcomes: 0 })
  })

  it('reconstructs BREAKOUT.1 separately and invalidates only its persisted definition mismatch', async () => {
    const breakout = breakoutManifest()
    const invalid = { ...breakout, exitPolicy: { ...breakout.exitPolicy, policyFingerprint: 'changed' } }
    const evidenceRepository = { getForwardObservationManifest: vi.fn(async ({ experimentId }) => experimentId === 'BREAKOUT.1' ? { manifest: invalid, status: 'collecting' } : null), listForwardEvidenceSnapshots: vi.fn(async () => []) }
    const statuses = await resolvePersistedForwardObservationStatuses({ ...scope, evidenceRepository, ledgerRepository: { listExecutions: async () => [{ experimentId: 'EDGE.2', exitAttribution: {} }] } })
    expect(statuses[0].status).toBe('NOT_STARTED')
    expect(statuses[1]).toMatchObject({ experimentId: 'BREAKOUT.1', strategyId: 'breakout-momentum-v1', status: 'INVALIDATED', completedOutcomes: 0, reason: 'frozen_configuration_changed' })
  })

  it('does not create cohorts and degrades a missing repository without exposing another account scope', async () => {
    const status = await resolvePersistedForwardObservationStatuses({ ...scope, evidenceRepository: {}, ledgerRepository: { listExecutions: vi.fn(async () => []) } })
    expect(status).toHaveLength(4)
    expect(status.every((entry) => entry.status === 'UNAVAILABLE')).toBe(true)
  })
})