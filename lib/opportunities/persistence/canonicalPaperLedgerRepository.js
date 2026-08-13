import { AppError } from '../../errors/appError.js'
import { applyPaperPortfolioAccounting } from '../../../src/core/accounting/paperPortfolioAccountingEngine.js'
import { simulatePaperPositionExit, createPaperExitFingerprint } from '../paperExit/index.js'

export const PAPER_LEDGER_ERRORS = Object.freeze({
  unavailable: 'paper_ledger_unavailable',
  invalidScope: 'paper_ledger_tenant_scope_invalid',
  evidenceMissing: 'paper_ledger_evidence_missing',
  conflict: 'paper_ledger_conflict',
  inconsistent: 'paper_ledger_state_inconsistent',
})

export const DEFAULT_INITIAL_PAPER_BALANCE = 100_000

function ledgerError(code, detail, statusCode = 503, publicMessage = 'paper ledger is unavailable') {
  return new AppError(code, detail, {
    statusCode,
    publicMessage,
    metadata: { paperTradingOnly: true },
  })
}

function finite(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function normalizedScope(input = {}) {
  const tenant = input.tenantContext ?? input.tenantScope ?? {}
  const scope = {
    organizationId: String(tenant.organizationId ?? '').trim(),
    teamWorkspaceId: String(tenant.teamWorkspaceId ?? '').trim(),
    accountId: String(input.accountId ?? '').trim(),
    userId: String(input.userId ?? tenant.userId ?? '').trim(),
  }
  if (!scope.organizationId || !scope.accountId || !scope.userId) {
    throw ledgerError(PAPER_LEDGER_ERRORS.invalidScope, 'Organization, account, and user scope are required.', 403, 'paper ledger tenant scope is invalid')
  }
  return scope
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function scopedId(prefix, values) {
  return `${prefix}-${await sha256(values)}`
}

function accountFromRow(row = {}) {
  return {
    recordId: row.id,
    accountId: row.account_id ?? row.accountId,
    organizationId: row.organization_id ?? row.organizationId,
    teamWorkspaceId: row.team_workspace_id ?? row.teamWorkspaceId ?? null,
    userId: row.user_id ?? row.userId,
    cash: finite(row.cash),
    buyingPower: finite(row.buying_power ?? row.buyingPower),
    equity: finite(row.equity),
    realizedPnl: finite(row.realized_pnl ?? row.realizedPnl),
    revision: finite(row.revision),
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
    paperTradingOnly: true,
  }
}

function positionFromRow(row = {}) {
  return {
    positionId: row.id,
    accountRecordId: row.account_record_id ?? row.accountRecordId,
    accountId: row.account_id ?? row.accountId,
    symbol: String(row.symbol ?? '').toUpperCase(),
    assetType: row.asset_type ?? row.assetType,
    side: row.side,
    quantity: finite(row.quantity),
    averagePrice: finite(row.average_cost ?? row.averagePrice),
    currentPrice: finite(row.current_price ?? row.currentPrice ?? row.average_cost),
    realizedPnl: finite(row.realized_pnl ?? row.realizedPnl),
    originatingCandidateId: row.originating_candidate_id ?? row.originatingCandidateId ?? null,
    originatingEvaluationId: row.originating_evaluation_id ?? row.originatingEvaluationId ?? null,
    originatingIntentFingerprint: row.originating_intent_fingerprint ?? row.originatingIntentFingerprint ?? null,
    strategyId: row.strategy_id ?? row.strategyId ?? null,
    status: row.status ?? (finite(row.quantity) > 0 ? 'open' : 'closed'),
    revision: finite(row.revision),
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
    paperTradingOnly: true,
  }
}

function executionFromRow(row = {}) {
  const payload = row.payload ?? {}
  return {
    executionId: row.id ?? payload.executionId,
    accountRecordId: row.account_record_id ?? payload.accountRecordId,
    accountId: row.account_id ?? payload.accountId,
    positionId: row.position_id ?? payload.positionId,
    executionType: row.execution_type ?? payload.executionType,
    fingerprint: row.idempotency_fingerprint ?? payload.fingerprint,
    symbol: row.symbol ?? payload.symbol,
    strategyId: row.strategy_id ?? payload.strategyId,
    side: row.side ?? payload.side,
    quantity: finite(row.quantity ?? payload.quantity),
    fillPrice: finite(row.fill_price ?? payload.fillPrice),
    fees: finite(row.fees ?? payload.fees),
    slippageBps: finite(row.slippage_bps ?? payload.slippageBps),
    cashImpact: finite(row.cash_impact ?? payload.cashImpact),
    realizedPnlDelta: finite(row.realized_pnl_delta ?? payload.realizedPnlDelta),
    evidenceTimestamp: row.evidence_timestamp ?? payload.evidenceTimestamp,
    engineVersion: row.engine_version ?? payload.engineVersion,
    payload,
    createdAt: row.created_at ?? payload.createdAt ?? null,
    paperTradingOnly: true,
  }
}

function compactExecutionPayload(input = {}) {
  return {
    executionId: input.executionId,
    accountRecordId: input.accountRecordId,
    accountId: input.accountId,
    positionId: input.positionId,
    executionType: input.executionType,
    fingerprint: input.fingerprint,
    candidateId: input.candidateId ?? null,
    evaluationId: input.evaluationId ?? null,
    evaluationEvidenceFingerprint: input.evaluationEvidenceFingerprint ?? null,
    executionIntentFingerprint: input.executionIntentFingerprint ?? null,
    strategyId: input.strategyId ?? null,
    symbol: input.symbol,
    assetType: input.assetType,
    side: input.side,
    quantity: input.quantity,
    fillPrice: input.fillPrice,
    fees: input.fees,
    slippageBps: input.slippageBps,
    cashImpact: input.cashImpact,
    realizedPnlDelta: input.realizedPnlDelta,
    accountingStatus: input.accountingStatus,
    evidenceTimestamp: input.evidenceTimestamp,
    engineVersion: input.engineVersion,
    journal: input.journal ?? null,
    tradeQuality: input.tradeQuality ?? null,
    regime: input.regime ?? null,
    evaluationStatus: input.evaluationStatus ?? null,
    paperTradingOnly: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

async function ensureAccount(client, scope, initialBalance, { lock = false } = {}) {
  const id = await scopedId('paper-account', [scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId])
  await client.query(
    `INSERT INTO atlas_paper_accounts
      (id, organization_id, team_workspace_id, account_id, user_id, cash, buying_power, equity, realized_pnl, revision, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$6,$6,0,0,NOW(),NOW())
     ON CONFLICT (organization_id, team_workspace_id, account_id, user_id) DO NOTHING`,
    [id, scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId, initialBalance],
  )
  const result = await client.query(
    `SELECT * FROM atlas_paper_accounts
     WHERE organization_id=$1 AND team_workspace_id=$2 AND account_id=$3 AND user_id=$4
     ${lock ? 'FOR UPDATE' : ''}`,
    [scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId],
  )
  if (!result.rows?.[0]) throw ledgerError(PAPER_LEDGER_ERRORS.inconsistent, 'Canonical paper account could not be loaded.')
  return accountFromRow(result.rows[0])
}

async function loadPositions(client, accountRecordId, { lock = false, includeClosed = false } = {}) {
  const result = await client.query(
    `SELECT * FROM atlas_paper_positions
     WHERE account_record_id=$1 ${includeClosed ? '' : "AND status='open' AND quantity>0"}
     ORDER BY symbol, asset_type, side
     ${lock ? 'FOR UPDATE' : ''}`,
    [accountRecordId],
  )
  return (result.rows ?? []).map(positionFromRow)
}

async function verifyEntryEvidence(client, scope, simulation) {
  const evaluation = await client.query(
    `SELECT id FROM atlas_ai_opportunity_analysis_history
     WHERE organization_id=$1 AND COALESCE(team_workspace_id,'')=$2 AND account_id=$3 AND user_id=$4
       AND analysis_category='paper_evaluation'
       AND payload->'paperEvaluation'->>'evaluationId'=$5
       AND context_fingerprint=$6
     LIMIT 1`,
    [scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId, simulation.evaluationId, simulation.evaluationEvidenceFingerprint],
  )
  const intent = await client.query(
    `SELECT id FROM atlas_ai_opportunity_analysis_history
     WHERE organization_id=$1 AND COALESCE(team_workspace_id,'')=$2 AND account_id=$3 AND user_id=$4
       AND analysis_category='paper_simulation' AND context_fingerprint=$5
     LIMIT 1`,
    [scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId, simulation.fingerprint],
  )
  if (!evaluation.rows?.[0] || !intent.rows?.[0]) {
    throw ledgerError(PAPER_LEDGER_ERRORS.evidenceMissing, 'Durable PA.1 evaluation or PA.2 intent linkage is missing.', 409, 'durable paper evidence linkage is missing')
  }
  return { evaluationRecordId: evaluation.rows[0].id, intentRecordId: intent.rows[0].id }
}

export function resolveCanonicalPaperLedgerRepository({ persistenceRepository, ledgerRepository, env = process.env } = {}) {
  if (ledgerRepository) {
    if (ledgerRepository.persistenceMode === 'memory' && env.NODE_ENV === 'production') {
      throw ledgerError(PAPER_LEDGER_ERRORS.unavailable, 'Process-memory paper ledger is prohibited in production.')
    }
    return ledgerRepository
  }
  if (persistenceRepository?.connected !== true || typeof persistenceRepository.query !== 'function' || typeof persistenceRepository.transaction !== 'function') {
    throw ledgerError(PAPER_LEDGER_ERRORS.unavailable, 'Canonical PostgreSQL paper ledger is not connected.')
  }
  return createCanonicalPaperLedgerRepository({ database: persistenceRepository })
}

export function createCanonicalPaperLedgerRepository({ database, initialBalance = DEFAULT_INITIAL_PAPER_BALANCE } = {}) {
  if (!database?.connected || typeof database.query !== 'function' || typeof database.transaction !== 'function') {
    throw ledgerError(PAPER_LEDGER_ERRORS.unavailable, 'Canonical PostgreSQL paper ledger is not connected.')
  }

  return {
    connected: true,
    persistenceMode: 'postgresql',

    async getOrCreateAccount(input = {}) {
      const scope = normalizedScope(input)
      return database.transaction(async (client) => {
        const account = await ensureAccount(client, scope, initialBalance)
        const positions = await loadPositions(client, account.recordId)
        return { account, positions }
      })
    },

    async listOpenPositions(input = {}) {
      const { account, positions } = await this.getOrCreateAccount(input)
      return positions.map((position) => ({ ...position, accountId: account.accountId }))
    },

    async listExecutions(input = {}) {
      const scope = normalizedScope(input)
      const limit = Math.min(500, Math.max(1, Number(input.limit) || 200))
      const result = await database.query(
        `SELECT * FROM atlas_paper_executions
         WHERE organization_id=$1 AND team_workspace_id=$2 AND account_id=$3 AND user_id=$4
         ORDER BY created_at ASC, id ASC LIMIT $5`,
        [scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId, limit],
      )
      return (result.rows ?? []).map(executionFromRow)
    },

    async commitEntry(input = {}) {
      const scope = normalizedScope(input)
      const simulation = input.simulation ?? {}
      const fill = simulation.executionFill
      if (simulation.status !== 'SIMULATED_FILLED' || !simulation.fingerprint || !simulation.evaluationId || !simulation.evaluationEvidenceFingerprint || !fill) {
        throw ledgerError(PAPER_LEDGER_ERRORS.evidenceMissing, 'A filled PA.2 result with durable evidence and fill linkage is required.', 409, 'durable paper evidence linkage is missing')
      }
      return database.transaction(async (client) => {
        const account = await ensureAccount(client, scope, initialBalance, { lock: true })
        const evidence = await verifyEntryEvidence(client, scope, simulation)
        const positions = await loadPositions(client, account.recordId, { lock: true })
        const accounting = applyPaperPortfolioAccounting({ id: scope.accountId, cash: account.cash, equity: account.equity, realizedPnl: account.realizedPnl, positions }, { finalStatus: 'filled', fill }, { emitEvent: false, timestamp: simulation.simulatedAt })
        if (accounting.status === 'rejected' || accounting.account.cash < 0) {
          throw ledgerError(PAPER_LEDGER_ERRORS.conflict, 'Durable account state no longer permits this entry.', 409, 'paper account state changed; retry evaluation')
        }
        const projected = accounting.positions.find((position) => position.symbol === simulation.symbol && position.side === (fill.side === 'short' ? 'short' : 'long'))
        if (!projected) throw ledgerError(PAPER_LEDGER_ERRORS.inconsistent, 'Entry accounting did not produce a canonical position.')
        const positionId = await scopedId('paper-position', [account.recordId, projected.symbol, projected.assetType, projected.side])
        const executionId = await scopedId('paper-execution', [account.recordId, simulation.fingerprint])
        const payload = compactExecutionPayload({
          executionId, accountRecordId: account.recordId, accountId: scope.accountId, positionId,
          executionType: 'entry', fingerprint: simulation.fingerprint, candidateId: simulation.candidateId,
          evaluationId: simulation.evaluationId, evaluationEvidenceFingerprint: simulation.evaluationEvidenceFingerprint,
          executionIntentFingerprint: simulation.fingerprint, strategyId: simulation.strategyId, symbol: simulation.symbol,
          assetType: fill.assetType, side: fill.side, quantity: fill.quantity, fillPrice: fill.fillPrice,
          fees: fill.fees, slippageBps: fill.slippageBps, cashImpact: fill.cashImpact, realizedPnlDelta: 0,
          accountingStatus: accounting.status, evidenceTimestamp: simulation.orderPlan?.evidenceTimestamp,
          engineVersion: simulation.engineVersion, journal: simulation.journal, tradeQuality: simulation.tradeQuality,
          regime: simulation.regime, evaluationStatus: simulation.evaluationStatus,
          evidence,
        })
        const inserted = await client.query(
          `INSERT INTO atlas_paper_executions
            (id,account_record_id,organization_id,team_workspace_id,account_id,user_id,position_id,execution_type,idempotency_fingerprint,candidate_id,evaluation_id,execution_intent_id,strategy_id,symbol,asset_type,side,quantity,fill_price,fees,slippage_bps,cash_impact,realized_pnl_delta,evidence_timestamp,engine_version,payload,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'entry',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,0,$21,$22,$23,NOW())
           ON CONFLICT (account_record_id,idempotency_fingerprint) DO NOTHING RETURNING *`,
          [executionId, account.recordId, scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId, positionId, simulation.fingerprint, simulation.candidateId, simulation.evaluationId, evidence.intentRecordId, simulation.strategyId, simulation.symbol, fill.assetType, fill.side, fill.quantity, fill.fillPrice, fill.fees, fill.slippageBps, fill.cashImpact, simulation.orderPlan?.evidenceTimestamp ?? simulation.simulatedAt, simulation.engineVersion, payload],
        )
        if (!inserted.rows?.[0]) {
          const existing = await client.query('SELECT * FROM atlas_paper_executions WHERE account_record_id=$1 AND idempotency_fingerprint=$2', [account.recordId, simulation.fingerprint])
          return { ok: true, duplicate: true, execution: executionFromRow(existing.rows[0]), account, positions }
        }
        const buyingPower = Math.max(0, account.buyingPower + finite(fill.cashImpact))
        const accountWrite = await client.query(
          `UPDATE atlas_paper_accounts SET cash=$2,buying_power=$3,equity=$4,realized_pnl=$5,revision=revision+1,updated_at=NOW()
           WHERE id=$1 AND revision=$6 RETURNING *`,
          [account.recordId, accounting.account.cash, buyingPower, accounting.account.equity, accounting.account.realizedPnl, account.revision],
        )
        if (!accountWrite.rows?.[0]) throw ledgerError(PAPER_LEDGER_ERRORS.conflict, 'Paper account revision changed during entry.', 409, 'paper account state changed; retry evaluation')
        const positionWrite = await client.query(
          `INSERT INTO atlas_paper_positions
            (id,account_record_id,organization_id,team_workspace_id,account_id,user_id,symbol,asset_type,side,quantity,average_cost,current_price,realized_pnl,originating_candidate_id,originating_evaluation_id,originating_intent_fingerprint,strategy_id,status,revision,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'open',0,NOW(),NOW())
           ON CONFLICT (account_record_id,symbol,asset_type,side) DO UPDATE SET quantity=EXCLUDED.quantity,average_cost=EXCLUDED.average_cost,current_price=EXCLUDED.current_price,originating_candidate_id=COALESCE(atlas_paper_positions.originating_candidate_id,EXCLUDED.originating_candidate_id),originating_evaluation_id=COALESCE(atlas_paper_positions.originating_evaluation_id,EXCLUDED.originating_evaluation_id),originating_intent_fingerprint=COALESCE(atlas_paper_positions.originating_intent_fingerprint,EXCLUDED.originating_intent_fingerprint),strategy_id=EXCLUDED.strategy_id,status='open',revision=atlas_paper_positions.revision+1,updated_at=NOW()
           RETURNING *`,
          [positionId, account.recordId, scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId, projected.symbol, projected.assetType, projected.side, projected.quantity, projected.averagePrice, projected.currentPrice, projected.realizedPnl, simulation.candidateId, simulation.evaluationId, simulation.fingerprint, simulation.strategyId],
        )
        return { ok: true, duplicate: false, execution: executionFromRow(inserted.rows[0]), account: accountFromRow(accountWrite.rows[0]), position: positionFromRow(positionWrite.rows[0]), accounting }
      })
    },

    async commitExit(input = {}) {
      const scope = normalizedScope(input)
      if (!input.positionId) throw ledgerError(PAPER_LEDGER_ERRORS.inconsistent, 'A canonical position id is required.', 400, 'paper position is invalid')
      return database.transaction(async (client) => {
        const account = await ensureAccount(client, scope, initialBalance, { lock: true })
        const selected = await client.query(
          `SELECT * FROM atlas_paper_positions
           WHERE id=$1 AND account_record_id=$2 AND organization_id=$3 AND team_workspace_id=$4 AND account_id=$5 AND user_id=$6
           FOR UPDATE`,
          [input.positionId, account.recordId, scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId],
        )
        if (!selected.rows?.[0]) throw ledgerError(PAPER_LEDGER_ERRORS.inconsistent, 'Canonical paper position was not found.', 404, 'paper position was not found')
        const position = positionFromRow(selected.rows[0])
        const requestedQuantity = finite(input.quantity, NaN)
        const closingSide = position.side === 'short' ? 'cover' : 'sell'
        const fingerprint = createPaperExitFingerprint({ positionId: position.positionId, quantity: requestedQuantity, quote: input.quote, side: closingSide })
        const prior = await client.query('SELECT * FROM atlas_paper_executions WHERE account_record_id=$1 AND idempotency_fingerprint=$2', [account.recordId, fingerprint])
        if (prior.rows?.[0]) return { ok: true, duplicate: true, execution: executionFromRow(prior.rows[0]), result: prior.rows[0].payload?.paperResult }
        if (position.status !== 'open' || position.quantity <= 0) throw ledgerError(PAPER_LEDGER_ERRORS.conflict, 'Canonical paper position is already closed.', 409, 'paper position is already closed')
        const result = simulatePaperPositionExit({ position, account, quantity: requestedQuantity, quote: input.quote, paperModeEnabled: input.paperModeEnabled === true }, { now: input.now })
        if (!['POSITION_CLOSED', 'POSITION_REDUCED'].includes(result.status)) return { ok: false, duplicate: false, result }
        const fill = {
          assetType: position.assetType, side: closingSide, quantity: requestedQuantity,
          fillPrice: result.exitPlan.simulatedExitPrice, fees: result.exitPlan.fees,
          slippageBps: result.exitPlan.slippageBps,
          cashImpact: result.accountSnapshot.cash - account.cash,
        }
        const executionType = result.status === 'POSITION_CLOSED' ? 'close' : 'reduction'
        const executionId = await scopedId('paper-execution', [account.recordId, fingerprint])
        const payload = compactExecutionPayload({
          executionId, accountRecordId: account.recordId, accountId: scope.accountId,
          positionId: position.positionId, executionType, fingerprint,
          candidateId: position.originatingCandidateId, evaluationId: position.originatingEvaluationId,
          executionIntentFingerprint: position.originatingIntentFingerprint, strategyId: position.strategyId,
          symbol: position.symbol, assetType: position.assetType, side: closingSide, quantity: requestedQuantity,
          fillPrice: fill.fillPrice, fees: fill.fees, slippageBps: fill.slippageBps, cashImpact: fill.cashImpact,
          realizedPnlDelta: result.exitPlan.realizedPnlDelta, accountingStatus: executionType === 'close' ? 'position_closed' : 'position_reduced',
          evidenceTimestamp: result.exitPlan.evidenceTimestamp, engineVersion: result.engineVersion, journal: result.journal,
          tradeQuality: result.tradeQuality, regime: result.regime, evaluationStatus: result.evaluationStatus,
        })
        payload.paperResult = result
        const inserted = await client.query(
          `INSERT INTO atlas_paper_executions
            (id,account_record_id,organization_id,team_workspace_id,account_id,user_id,position_id,execution_type,idempotency_fingerprint,candidate_id,evaluation_id,execution_intent_id,strategy_id,symbol,asset_type,side,quantity,fill_price,fees,slippage_bps,cash_impact,realized_pnl_delta,evidence_timestamp,engine_version,payload,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,NOW())
           ON CONFLICT (account_record_id,idempotency_fingerprint) DO NOTHING RETURNING *`,
          [executionId, account.recordId, scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId, position.positionId, executionType, fingerprint, position.originatingCandidateId, position.originatingEvaluationId, position.originatingIntentFingerprint, position.strategyId, position.symbol, position.assetType, closingSide, requestedQuantity, fill.fillPrice, fill.fees, fill.slippageBps, fill.cashImpact, result.exitPlan.realizedPnlDelta, result.exitPlan.evidenceTimestamp, result.engineVersion, payload],
        )
        if (!inserted.rows?.[0]) {
          const existing = await client.query('SELECT * FROM atlas_paper_executions WHERE account_record_id=$1 AND idempotency_fingerprint=$2', [account.recordId, fingerprint])
          return { ok: true, duplicate: true, execution: executionFromRow(existing.rows[0]), result: existing.rows[0].payload?.paperResult }
        }
        const accountWrite = await client.query(
          `UPDATE atlas_paper_accounts SET cash=$2,buying_power=$3,equity=$4,realized_pnl=$5,revision=revision+1,updated_at=NOW()
           WHERE id=$1 AND revision=$6 RETURNING *`,
          [account.recordId, result.accountSnapshot.cash, Math.max(0, account.buyingPower + fill.cashImpact), result.accountSnapshot.equity, result.accountSnapshot.realizedPnl, account.revision],
        )
        if (!accountWrite.rows?.[0]) throw ledgerError(PAPER_LEDGER_ERRORS.conflict, 'Paper account revision changed during exit.', 409, 'paper account state changed; retry exit')
        const remaining = result.positionSnapshot
        const positionWrite = await client.query(
          `UPDATE atlas_paper_positions SET quantity=$2,average_cost=$3,current_price=$4,realized_pnl=realized_pnl+$5,status=$6,revision=revision+1,updated_at=NOW()
           WHERE id=$1 AND revision=$7 RETURNING *`,
          [position.positionId, remaining?.quantity ?? 0, remaining?.averagePrice ?? position.averagePrice, fill.fillPrice, result.exitPlan.realizedPnlDelta, remaining ? 'open' : 'closed', position.revision],
        )
        if (!positionWrite.rows?.[0]) throw ledgerError(PAPER_LEDGER_ERRORS.conflict, 'Paper position revision changed during exit.', 409, 'paper position state changed; retry exit')
        return { ok: true, duplicate: false, execution: executionFromRow(inserted.rows[0]), account: accountFromRow(accountWrite.rows[0]), position: positionFromRow(positionWrite.rows[0]), result }
      })
    },
  }
}
