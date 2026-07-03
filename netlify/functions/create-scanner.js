import { createApiHandler } from './_shared/api.js'

export const handler = createApiHandler(({ body, service }) => {
  return service.createScanner(body)
}, { allowedMethods: ['POST'] })
