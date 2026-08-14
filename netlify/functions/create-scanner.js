import { createProtectedWorkspaceApiHandler } from './_shared/protectedWorkspaceApi.js'

export const handler = createProtectedWorkspaceApiHandler(({ body, service }) => {
  return service.createScanner(body)
}, { allowedMethods: ['POST'], mutation: true, routeId: 'create-scanner' })
