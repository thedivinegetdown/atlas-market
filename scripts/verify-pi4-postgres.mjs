import { randomUUID } from 'node:crypto'
import { createPostgresRepository } from '../lib/db/postgresRepository.js'
import { createDurableWorkspaceStateRepository } from '../lib/persistence/durablePaperWorkflowProjections.js'

if (!process.env.DATABASE_URL) throw new Error('Approved local DATABASE_URL is required.')

const repository = createPostgresRepository()
const suffix = randomUUID()
const scannerId = `pi4-scanner-${suffix}`
const alertId = `pi4-alert-${suffix}`
const scopeA = { tenantContext: { organizationId: `pi4-org-a-${suffix}`, teamWorkspaceId: `pi4-team-${suffix}` }, accountId: `pi4-account-${suffix}`, userId: `pi4-user-${suffix}` }
const scopeB = { ...scopeA, tenantContext: { ...scopeA.tenantContext, organizationId: `pi4-org-b-${suffix}` } }

try {
  const initialized = await repository.initialize()
  if (!initialized.ok || initialized.health?.connected !== true) throw new Error('PostgreSQL initialization failed.')
  const state = createDurableWorkspaceStateRepository({ database: repository })
  await state.saveScanner(scopeA, { id: scannerId, name: 'PI.4 synthetic scanner', assetType: 'stock', symbols: ['AAPL'], criteria: [{ type: 'price_above', threshold: 1 }], enabled: true })
  await state.saveAlert(scopeA, { id: alertId, label: 'PI.4 synthetic alert', symbol: 'AAPL', assetType: 'stock', alertType: 'price_above', threshold: 1, channels: { inApp: true }, enabled: true })
  const reloaded = createDurableWorkspaceStateRepository({ database: repository })
  const [scanners, alerts, crossTenantScanners, migration, indexes] = await Promise.all([
    reloaded.listScanners(scopeA),
    reloaded.listAlerts(scopeA),
    reloaded.listScanners(scopeB),
    repository.query('SELECT id FROM atlas_schema_migrations WHERE id=$1', ['202608130070_pi4_durable_workspace_definitions']),
    repository.query(`SELECT indexname FROM pg_indexes WHERE schemaname=current_schema() AND indexname IN ($1,$2) ORDER BY indexname`, ['idx_atlas_realtime_alerts_scope', 'idx_atlas_realtime_scanners_scope']),
  ])
  if (!scanners.some((item) => item.id === scannerId) || !alerts.some((item) => item.id === alertId)) throw new Error('Durable definition re-instantiation verification failed.')
  if (crossTenantScanners.some((item) => item.id === scannerId)) throw new Error('Cross-organization isolation verification failed.')
  if (migration.rows.length !== 1 || indexes.rows.length !== 2) throw new Error('PI.4 migration tracking or indexes are missing.')
  console.log(JSON.stringify({ ok: true, target: 'approved-local-non-production', migrationTracked: true, indexesVerified: 2, scannerDurable: true, alertDurable: true, crossOrganizationDenied: true, credentialsPrinted: false }))
} finally {
  await repository.query('DELETE FROM atlas_realtime_scanner_subscriptions WHERE id=$1', [scannerId]).catch(() => {})
  await repository.query('DELETE FROM atlas_realtime_alerts WHERE id=$1', [alertId]).catch(() => {})
  await repository.end()
}
