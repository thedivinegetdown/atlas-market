import { createProtectedWorkspaceApiHandler } from './_shared/protectedWorkspaceApi.js'
import { AppError } from '../../lib/errors/appError.js'

export const handler = createProtectedWorkspaceApiHandler(() => {
  throw new AppError('legacy_paper_mutation_disabled', 'Legacy PAPER mutation route is disabled and non-authoritative.', {
    statusCode: 410,
    publicMessage: 'legacy PAPER mutation route is disabled and non-authoritative',
  })
}, { allowedMethods: ['POST'], mutation: true, routeId: 'cancel-paper-order' })
