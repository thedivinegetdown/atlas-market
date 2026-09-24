import fs from 'node:fs'
import { Pool } from 'pg'
import { verifyGap5RestoredDatabase } from '../lib/persistence/gap5RecoveryVerification.js'

const env = process.env
if (env.ATLAS_RESTORE_TARGET_CONFIRMED_ISOLATED !== 'true') throw new Error('ATLAS_RESTORE_TARGET_CONFIRMED_ISOLATED=true is required.')
if (!env.ATLAS_RESTORE_DATABASE_URL) throw new Error('An authorized isolated ATLAS_RESTORE_DATABASE_URL is required.')
if (!env.ATLAS_BACKUP_EVIDENCE_MANIFEST_PATH) throw new Error('ATLAS_BACKUP_EVIDENCE_MANIFEST_PATH is required.')
if (!env.ATLAS_RECOVERY_INCIDENT_AT || !env.ATLAS_RESTORE_STARTED_AT) throw new Error('ATLAS_RECOVERY_INCIDENT_AT and ATLAS_RESTORE_STARTED_AT are required.')

const expectedBaseline = JSON.parse(fs.readFileSync(env.ATLAS_BACKUP_EVIDENCE_MANIFEST_PATH, 'utf8'))
const pool = new Pool({ connectionString: env.ATLAS_RESTORE_DATABASE_URL, max: 2, connectionTimeoutMillis: 5000, statement_timeout: 15000, query_timeout: 15000, ssl: { rejectUnauthorized: true }, allowExitOnIdle: true })
const database = { connected: true, query: (text, params = []) => pool.query(text, params) }

async function rollbackProbe() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('CREATE TEMP TABLE atlas_gap5_restore_probe (id TEXT PRIMARY KEY) ON COMMIT DROP')
    await client.query('INSERT INTO atlas_gap5_restore_probe (id) VALUES ($1)', ['rollback-probe'])
    await client.query('ROLLBACK')
    const result = await client.query("SELECT to_regclass('pg_temp.atlas_gap5_restore_probe') AS probe")
    return result.rows?.[0]?.probe == null
  } finally {
    client.release()
  }
}

try {
  const result = await verifyGap5RestoredDatabase({
    database,
    expectedBaseline,
    recoveryTimings: {
      incidentAt: env.ATLAS_RECOVERY_INCIDENT_AT,
      restoreStartedAt: env.ATLAS_RESTORE_STARTED_AT,
      validatedAt: new Date().toISOString(),
    },
    rollbackProbe,
  })
  console.log(JSON.stringify(result))
  if (!result.ok) process.exitCode = 1
} finally {
  await pool.end()
}
