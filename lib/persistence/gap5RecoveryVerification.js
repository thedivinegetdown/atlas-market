import { buildCanonicalPaperOutcomes } from '../analytics/canonicalPaperOutcomes.js'

export const GAP5_RECOVERY_CONTRACT_VERSION = 'gap5-recovery-verification-v1'

export const GAP5_REQUIRED_TABLES = Object.freeze([
  'atlas_schema_migrations',
  'atlas_ai_opportunity_analysis_history',
  'atlas_paper_accounts',
  'atlas_paper_positions',
  'atlas_paper_executions',
  'atlas_governed_review_preparations',
])

const REQUIRED_UNIQUENESS = Object.freeze([
  /UNIQUE \(organization_id, team_workspace_id, account_id, user_id\)/i,
  /UNIQUE \(account_record_id, symbol, asset_type, side\)/i,
  /UNIQUE \(account_record_id, idempotency_fingerprint\)/i,
])

function timestamp(value, name) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new Error(`${name} is invalid`)
  return parsed
}

export function measureRecoveryObjectives({ recoveryPointAt, incidentAt, restoreStartedAt, validatedAt } = {}) {
  const recoveryPoint = timestamp(recoveryPointAt, 'recoveryPointAt')
  const incident = timestamp(incidentAt, 'incidentAt')
  const restoreStarted = timestamp(restoreStartedAt, 'restoreStartedAt')
  const validated = timestamp(validatedAt, 'validatedAt')
  const rpoMs = incident.getTime() - recoveryPoint.getTime()
  const rtoMs = validated.getTime() - restoreStarted.getTime()
  if (rpoMs < 0 || rtoMs < 0) throw new Error('recovery chronology is invalid')
  return { rpoMs, rtoMs, rpoMinutes: rpoMs / 60000, rtoMinutes: rtoMs / 60000 }
}

function assertBaseline(expected = {}) {
  const countKeys = ['manifests', 'snapshots', 'executions', 'closeExecutions', 'canonicalOutcomes', 'governedPreparations']
  if (!expected.recoveryPointId || !Array.isArray(expected.migrationIds) || !expected.counts) throw new Error('backup evidence baseline is incomplete')
  for (const key of countKeys) {
    if (!Number.isInteger(expected.counts[key]) || expected.counts[key] < 0) throw new Error(`backup evidence count ${key} is invalid`)
  }
  return expected
}

function normalizedCountRow(row = {}) {
  return {
    manifests: Number(row.manifests ?? 0),
    snapshots: Number(row.snapshots ?? 0),
    executions: Number(row.executions ?? 0),
    closeExecutions: Number(row.close_executions ?? 0),
    governedPreparations: Number(row.governed_preparations ?? 0),
  }
}

export async function verifyGap5RestoredDatabase({ database, expectedBaseline, recoveryTimings, rollbackProbe } = {}) {
  if (!database?.connected || typeof database.query !== 'function') throw new Error('isolated restored database is not connected')
  if (typeof rollbackProbe !== 'function') throw new Error('rollback probe is required')
  const baseline = assertBaseline(expectedBaseline)
  const [tablesResult, migrationsResult, constraintsResult, indexesResult, countsResult, integrityResult, executionsResult] = await Promise.all([
    database.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema=current_schema() AND table_name=ANY($1::text[])
       ORDER BY table_name`,
      [GAP5_REQUIRED_TABLES],
    ),
    database.query('SELECT id FROM atlas_schema_migrations ORDER BY id', []),
    database.query(
      `SELECT c.conrelid::regclass::text AS table_name, c.contype, pg_get_constraintdef(c.oid) AS definition
       FROM pg_constraint c
       JOIN pg_namespace n ON n.oid=c.connamespace
       WHERE n.nspname=current_schema()
         AND c.conrelid::regclass::text=ANY($1::text[])
       ORDER BY table_name, definition`,
      [GAP5_REQUIRED_TABLES],
    ),
    database.query(
      `SELECT tablename, indexname, indexdef FROM pg_indexes
       WHERE schemaname=current_schema() AND tablename=ANY($1::text[])
       ORDER BY tablename,indexname`,
      [GAP5_REQUIRED_TABLES],
    ),
    database.query(
      `SELECT
        (SELECT COUNT(*)::int FROM atlas_ai_opportunity_analysis_history WHERE analysis_category='forward_observation_manifest') AS manifests,
        (SELECT COUNT(*)::int FROM atlas_ai_opportunity_analysis_history WHERE analysis_category='forward_evidence_snapshot') AS snapshots,
        (SELECT COUNT(*)::int FROM atlas_paper_executions) AS executions,
        (SELECT COUNT(*)::int FROM atlas_paper_executions WHERE execution_type='close') AS close_executions,
        (SELECT COUNT(*)::int FROM atlas_governed_review_preparations) AS governed_preparations`,
      [],
    ),
    database.query(
      `SELECT
        (SELECT COUNT(*)::int FROM atlas_ai_opportunity_analysis_history
          WHERE analysis_category IN ('forward_observation_manifest','forward_evidence_snapshot')
            AND (organization_id='' OR account_id='' OR user_id='' OR context_fingerprint='' OR context_fingerprint !~ '^[a-f0-9]{64}$')) AS invalid_observation_identity,
        (SELECT COUNT(*)::int FROM atlas_paper_executions
          WHERE organization_id='' OR account_id='' OR user_id='' OR idempotency_fingerprint='') AS invalid_execution_identity,
        (SELECT COUNT(*)::int FROM (
          SELECT account_record_id,idempotency_fingerprint FROM atlas_paper_executions
          GROUP BY account_record_id,idempotency_fingerprint HAVING COUNT(*)>1
        ) duplicates) AS duplicate_execution_fingerprints,
        (SELECT COUNT(*)::int FROM atlas_paper_executions e LEFT JOIN atlas_paper_accounts a ON a.id=e.account_record_id WHERE a.id IS NULL) AS orphan_executions,
        (SELECT COUNT(*)::int FROM atlas_paper_positions p LEFT JOIN atlas_paper_accounts a ON a.id=p.account_record_id WHERE a.id IS NULL) AS orphan_positions,
        (SELECT COUNT(*)::int FROM atlas_governed_review_preparations
          WHERE payload ? 'observationCoverage'
            AND jsonb_path_exists(payload, '$.observationCoverage.checks[*] ? (@.experimentId == "EDGE.2")')) AS edge2_coverage_rows`,
      [],
    ),
    database.query(
      `SELECT id,position_id,execution_type,idempotency_fingerprint,strategy_id,symbol,quantity,fees,cash_impact,realized_pnl_delta,evidence_timestamp,payload,created_at
       FROM atlas_paper_executions ORDER BY created_at ASC,id ASC`,
      [],
    ),
  ])

  const presentTables = new Set((tablesResult.rows ?? []).map((row) => row.table_name))
  const missingTables = GAP5_REQUIRED_TABLES.filter((table) => !presentTables.has(table))
  const migrationIds = (migrationsResult.rows ?? []).map((row) => row.id)
  const constraints = (constraintsResult.rows ?? []).map((row) => String(row.definition ?? ''))
  const indexDefinitions = (indexesResult.rows ?? []).map((row) => String(row.indexdef ?? ''))
  const missingUniqueness = REQUIRED_UNIQUENESS.filter((pattern) => !constraints.some((definition) => pattern.test(definition))).map(String)
  const activeClaimUnique = indexDefinitions.some((definition) => definition.includes('idx_atlas_governed_review_preparations_active_unique') && /UNIQUE/i.test(definition) && /pending.+running/i.test(definition))
  const executions = (executionsResult.rows ?? []).map((row) => ({
    executionId: row.id,
    fingerprint: row.idempotency_fingerprint,
    positionId: row.position_id,
    executionType: row.execution_type,
    strategyId: row.strategy_id,
    symbol: row.symbol,
    quantity: Number(row.quantity),
    fees: Number(row.fees),
    cashImpact: Number(row.cash_impact),
    realizedPnlDelta: Number(row.realized_pnl_delta),
    evidenceTimestamp: row.evidence_timestamp,
    payload: row.payload,
    createdAt: row.created_at,
  }))
  const outcomeMeasurement = buildCanonicalPaperOutcomes(executions)
  const counts = { ...normalizedCountRow(countsResult.rows?.[0]), canonicalOutcomes: outcomeMeasurement.outcomes.length }
  const integrity = Object.fromEntries(Object.entries(integrityResult.rows?.[0] ?? {}).map(([key, value]) => [key, Number(value)]))
  integrity.outcome_reconciliation_failures = outcomeMeasurement.outcomes.filter((outcome) => outcome.pnlReconciliation.status !== 'RECONCILED' || outcome.quantityReconciliation.status !== 'RECONCILED').length
  const countsMatch = Object.keys(baseline.counts).every((key) => counts[key] === baseline.counts[key])
  const migrationsMatch = JSON.stringify(migrationIds) === JSON.stringify(baseline.migrationIds)
  const rollbackVerified = await rollbackProbe()
  const recovery = measureRecoveryObjectives({ ...recoveryTimings, recoveryPointAt: baseline.recoveryPointAt })
  const integrityClean = Object.values(integrity).every((value) => value === 0)
  const ok = missingTables.length === 0 && missingUniqueness.length === 0 && activeClaimUnique && countsMatch && migrationsMatch && integrityClean && rollbackVerified === true

  return {
    version: GAP5_RECOVERY_CONTRACT_VERSION,
    ok,
    recoveryPointId: baseline.recoveryPointId,
    tables: { verified: GAP5_REQUIRED_TABLES.length - missingTables.length, missing: missingTables },
    migrations: { match: migrationsMatch, restored: migrationIds.length, expected: baseline.migrationIds.length },
    records: { match: countsMatch, restored: counts, expected: baseline.counts },
    integrity: { clean: integrityClean, ...integrity },
    uniqueness: { canonicalConstraintsPresent: missingUniqueness.length === 0, activeClaimUnique, missing: missingUniqueness },
    rollbackVerified,
    recovery,
    boundaries: { isolatedTargetRequired: true, productionCutoverPerformed: false, secretsPrinted: false, paperOnly: true },
  }
}
