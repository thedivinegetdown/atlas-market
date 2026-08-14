import { createAtlasAiRepository } from '../../ai/atlasAiGateway.js'
import { AppError, ERROR_CODES } from '../../errors/appError.js'

export const DURABLE_PAPER_EVIDENCE_ERROR = 'durable_paper_evidence_unavailable'

function unavailable(reason) {
  return new AppError(DURABLE_PAPER_EVIDENCE_ERROR, reason, {
    statusCode: 503,
    publicMessage: 'durable paper evidence is unavailable',
    metadata: { durable: false, retryable: true },
  })
}

export function resolveCanonicalPaperEvidenceRepository({
  opportunityRepository,
  persistenceRepository,
  env = process.env,
} = {}) {
  if (opportunityRepository) {
    if (opportunityRepository.persistenceMode === 'memory' && env.NODE_ENV === 'production') {
      throw unavailable('Process-memory paper evidence is prohibited in production.')
    }
    return opportunityRepository
  }
  if (persistenceRepository?.connected !== true || typeof persistenceRepository.query !== 'function') {
    throw unavailable('The canonical PostgreSQL paper-evidence repository is not connected.')
  }
  return createAtlasAiRepository({ database: persistenceRepository })
}

export function assertDurablePaperEvidenceWrite(result) {
  if (!result?.ok || result.disabled === true) {
    throw unavailable('The paper-evidence write was not durably committed.')
  }
  return result
}

export function assertExplicitNonProductionMemoryAdapter(repository, env = process.env) {
  if (repository?.persistenceMode !== 'memory') {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Explicit memory adapter is required.', {
      statusCode: 500,
      publicMessage: 'paper evidence adapter is invalid',
    })
  }
  if (env.NODE_ENV === 'production') throw unavailable('Process-memory paper evidence is prohibited in production.')
  return repository
}
