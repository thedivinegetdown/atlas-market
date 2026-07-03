import { createLogger } from '../../lib/logging/logger.js'

export const clientLogger = createLogger({
  name: 'atlas-market-client',
  level: import.meta.env.MODE === 'development' ? 'debug' : 'warn',
})
