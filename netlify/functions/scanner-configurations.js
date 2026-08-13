import { AppError } from '../../lib/errors/appError.js'
import { createScannerEvaluator } from '../../lib/scanners/scannerEvaluator.js'
import { validateScannerPayload } from '../../lib/scanners/scannerValidator.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'
import { durableScope, durableWorkspaceRepository } from './_shared/durablePaperWorkspace.js'

const failure = (validation) => ({ ok: false, statusCode: 400, error: validation.error })

export function createScannerConfigurationsHandler({ durableRepository, scannerEvaluator = createScannerEvaluator(), env = process.env, ...options } = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ event, query, body, tenantContext, user, membership, repository }) => {
    const source = event.httpMethod === 'GET' ? query : body
    const input = durableScope({ accountId: source.accountId, tenantContext, user })
    const state = durableWorkspaceRepository({ repository, durableRepository, env })
    const scanners = await state.listScanners(input)
    if (event.httpMethod === 'GET') return { paperTrading: true, scanners, canonicalDurableSource: true }
    if (!['owner', 'admin'].includes(membership.role)) throw new AppError('scanner_write_forbidden', 'Scanner configuration mutation requires workspace administration.', { statusCode: 403, publicMessage: 'forbidden' })

    const action = String(body.action ?? '').toLowerCase()
    if (action === 'evaluate') return { paperTrading: true, matches: await scannerEvaluator.evaluate(scanners), definitionsPersisted: true, matchesDerived: true }
    if (action === 'delete') return { paperTrading: true, deleted: await state.deleteScanner(input, String(body.id ?? '').trim()) }
    if (!['create', 'update'].includes(action)) throw new AppError('invalid_scanner_action', 'Scanner action is invalid.', { statusCode: 400, publicMessage: 'scanner action is invalid' })
    const existing = action === 'update' ? scanners.find((item) => item.id === body.id) : null
    if (action === 'update' && !existing) throw new AppError('scanner_not_found', 'Scanner was not found.', { statusCode: 404, publicMessage: 'scanner was not found' })
    const validation = validateScannerPayload({ ...(existing ?? {}), ...(body.scanner ?? body.payload ?? {}) })
    if (!validation.ok) return failure(validation)
    const scanner = await state.saveScanner(input, { ...validation.scanner, ...(existing ? { id: existing.id, createdAt: existing.createdAt } : {}) })
    return { paperTrading: true, scanner, canonicalDurableSource: true }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'scanner-configurations', env, ...options })
}

export const handler = createScannerConfigurationsHandler()
