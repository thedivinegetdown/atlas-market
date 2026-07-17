import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createPaperReportArtifactRepository, downloadPaperReportArtifact } from '../../lib/reports/paperReportArtifactEngine.js'
import { assertObjectTenantAccess, normalizeSafeId, requireAccountContext, safeContentDisposition } from '../../lib/security/securityPolicyEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership) {
  if (['owner', 'admin', 'analyst', 'viewer'].includes(membership?.role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Paper report artifact download denied', { statusCode: 403, publicMessage: 'paper report artifact download denied' })
}

export function createPaperReportArtifactDownloadHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext }) => {
    assertAccess(membership)
    const repository = options.paperReportArtifactRepository ?? createPaperReportArtifactRepository(options)
    const accountId = requireAccountContext(body.accountId ?? query.accountId ?? options.accountId)
    const artifactId = normalizeSafeId(body.artifactId ?? query.artifactId, 'artifactId')
    const artifact = await repository.get?.({ tenantContext, artifactId })
    if (!artifact) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Artifact is unavailable', { statusCode: 404, publicMessage: 'artifact unavailable' })
    }
    assertObjectTenantAccess(artifact, tenantContext, { accountId, fieldName: 'artifact' })
    const downloaded = downloadPaperReportArtifact(artifact, { emitEvent: false })
    if (downloaded.downloadStatus !== 'downloaded') {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, downloaded.reason, { statusCode: 410, publicMessage: 'artifact unavailable' })
    }
    await repository.update?.(downloaded.artifactRecord)
    const publicDownload = { ...downloaded }
    delete publicDownload.artifactRecord
    publicDownload.headers = { ...publicDownload.headers, 'content-disposition': safeContentDisposition(downloaded.paperReportArtifact.filename) }
    return { event: apiFoundationEvent({ requestId, endpoint: 'paper-report-artifact-download', status: downloaded.downloadStatus }), paperReportArtifactDownload: publicDownload, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'paper-report-artifact-download', ...options })
}

export const handler = createPaperReportArtifactDownloadHandler()
