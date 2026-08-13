import { createProtectedWorkspaceApiHandler } from './_shared/protectedWorkspaceApi.js'

export const handler = createProtectedWorkspaceApiHandler(({ service }) => {
  return service.evaluateScanners()
}, { allowedMethods: ['POST'], mutation: true, routeId: 'evaluate-scanners' })
