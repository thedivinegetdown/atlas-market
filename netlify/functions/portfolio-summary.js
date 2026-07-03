import { createApiHandler } from './_shared/api.js'

export const handler = createApiHandler(({ service }) => {
  return service.getPortfolioSummary()
})
