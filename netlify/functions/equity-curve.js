import { createProtectedWorkspaceApiHandler } from './_shared/protectedWorkspaceApi.js'

export const handler = createProtectedWorkspaceApiHandler(({ service }) => {
  return service.getEquityCurve()
}, { routeId: 'equity-curve' })
