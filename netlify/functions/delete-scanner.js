import { createApiHandler } from './_shared/api.js'

export const handler = createApiHandler(({ body, service }) => {
  return service.deleteScanner(body.id)
}, { allowedMethods: ['POST'] })
