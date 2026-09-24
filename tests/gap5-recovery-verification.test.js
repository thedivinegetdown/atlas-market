import fs from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  GAP5_REQUIRED_TABLES,
  measureRecoveryObjectives,
  verifyGap5RestoredDatabase,
} from '../lib/persistence/gap5RecoveryVerification.js'

const migrations = ['202608130069_pi3_transactional_paper_account_ledger', '202609120002_governed_review_preparations_physical_lifecycle_contract']
const counts = { manifests: 2, snapshots: 8, executions: 2, closeExecutions: 1, canonicalOutcomes: 1, governedPreparations: 3 }
const baseline = { recoveryPointId: 'recovery-point-redacted', recoveryPointAt: '2026-09-24T13:00:00.000Z', migrationIds: migrations, counts }
const recoveryTimings = { incidentAt: '2026-09-24T13:30:00.000Z', restoreStartedAt: '2026-09-24T14:00:00.000Z', validatedAt: '2026-09-24T14:45:00.000Z' }

function restoredDatabase({ integrity = {} } = {}) {
  return {
    connected: true,
    query: vi.fn(async (sql) => {
      if (sql.includes('information_schema.tables')) return { rows: GAP5_REQUIRED_TABLES.map((table_name) => ({ table_name })) }
      if (sql.includes('SELECT id FROM atlas_schema_migrations')) return { rows: migrations.map((id) => ({ id })) }
      if (sql.includes('pg_get_constraintdef')) return { rows: [
        { definition: 'UNIQUE (organization_id, team_workspace_id, account_id, user_id)' },
        { definition: 'UNIQUE (account_record_id, symbol, asset_type, side)' },
        { definition: 'UNIQUE (account_record_id, idempotency_fingerprint)' },
      ] }
      if (sql.includes('FROM pg_indexes')) return { rows: [{ indexdef: "CREATE UNIQUE INDEX idx_atlas_governed_review_preparations_active_unique WHERE status IN ('pending','running')" }] }
      if (sql.includes('AS manifests')) return { rows: [{ manifests: 2, snapshots: 8, executions: 2, close_executions: 1, governed_preparations: 3 }] }
      if (sql.includes('invalid_observation_identity')) return { rows: [{ invalid_observation_identity: 0, invalid_execution_identity: 0, duplicate_execution_fingerprints: 0, orphan_executions: 0, orphan_positions: 0, edge2_coverage_rows: 0, ...integrity }] }
      if (sql.includes('FROM atlas_paper_executions ORDER BY')) return { rows: [
        { id: 'entry-1', position_id: 'position-1', execution_type: 'entry', idempotency_fingerprint: 'entry-fingerprint', strategy_id: 'breakout-momentum-v1', symbol: 'SPY', quantity: 1, fees: 1, cash_impact: -101, realized_pnl_delta: 0, evidence_timestamp: '2026-09-24T13:05:00.000Z', created_at: '2026-09-24T13:05:00.000Z', payload: { plannedRisk: 20, attribution: { strategyFingerprint: 'strategy', policyFingerprint: 'policy', evaluationFingerprint: 'evaluation' }, valuation: { equity: 100000 }, accountEquityAfter: 99899 } },
        { id: 'close-1', position_id: 'position-1', execution_type: 'close', idempotency_fingerprint: 'close-fingerprint', strategy_id: 'breakout-momentum-v1', symbol: 'SPY', quantity: 1, fees: 1, cash_impact: 111, realized_pnl_delta: 10, evidence_timestamp: '2026-09-24T13:10:00.000Z', created_at: '2026-09-24T13:10:00.000Z', payload: { valuation: { equity: 99899 }, accountEquityAfter: 100010 } },
      ] }
      throw new Error(`unexpected recovery query: ${sql}`)
    }),
  }
}

describe('Gap 5 physical recovery acceptance contract', () => {
  it('measures actual elapsed RPO and RTO from evidence timestamps', () => {
    expect(measureRecoveryObjectives({ recoveryPointAt: baseline.recoveryPointAt, ...recoveryTimings })).toEqual({ rpoMs: 1_800_000, rtoMs: 2_700_000, rpoMinutes: 30, rtoMinutes: 45 })
  })

  it('accepts only a restored database matching baseline records, constraints, integrity, and rollback', async () => {
    const result = await verifyGap5RestoredDatabase({ database: restoredDatabase(), expectedBaseline: baseline, recoveryTimings, rollbackProbe: vi.fn(async () => true) })

    expect(result).toMatchObject({
      ok: true,
      records: { match: true, restored: counts },
      migrations: { match: true },
      integrity: { clean: true, edge2_coverage_rows: 0, outcome_reconciliation_failures: 0 },
      uniqueness: { canonicalConstraintsPresent: true, activeClaimUnique: true },
      rollbackVerified: true,
      recovery: { rpoMinutes: 30, rtoMinutes: 45 },
      boundaries: { isolatedTargetRequired: true, productionCutoverPerformed: false, secretsPrinted: false },
    })
  })

  it('rejects restored evidence with a tenant/fingerprint integrity gap', async () => {
    const result = await verifyGap5RestoredDatabase({ database: restoredDatabase({ integrity: { invalid_execution_identity: 1 } }), expectedBaseline: baseline, recoveryTimings, rollbackProbe: async () => true })
    expect(result.ok).toBe(false)
    expect(result.integrity).toMatchObject({ clean: false, invalid_execution_identity: 1 })
  })

  it('requires a timestamped backup evidence baseline instead of inferring recovery', async () => {
    await expect(verifyGap5RestoredDatabase({ database: restoredDatabase(), expectedBaseline: {}, recoveryTimings, rollbackProbe: async () => true })).rejects.toThrow('backup evidence baseline is incomplete')
  })

  it('cannot fall back to the application database or skip isolated-target confirmation', () => {
    const source = fs.readFileSync('scripts/verify-gap5-restored-database.mjs', 'utf8')
    expect(source).toContain("ATLAS_RESTORE_TARGET_CONFIRMED_ISOLATED !== 'true'")
    expect(source).toContain('env.ATLAS_RESTORE_DATABASE_URL')
    expect(source).not.toContain('env.DATABASE_URL')
  })
})
