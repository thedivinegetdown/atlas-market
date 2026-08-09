import { buildBriefingReadModel } from './buildBriefingReadModel.js'
import { DEFAULT_DAILY_BRIEFING_CONFIG } from './dailyBriefingConfig.js'
import { normalizeBriefingInputs } from './normalizeBriefingInputs.js'
import { rankBriefingPriorities } from './rankBriefingPriorities.js'

export function buildDailyBriefing(input = {}, options = {}) {
  const startedAt = Date.now()
  const config = options.config ?? DEFAULT_DAILY_BRIEFING_CONFIG
  const normalized = normalizeBriefingInputs(input, config)
  const priorities = rankBriefingPriorities(normalized, config)
  const result = buildBriefingReadModel(normalized, priorities)
  options.logger?.info?.('daily briefing built', { version: result.version, status: result.status, priorityCount: result.priorities.length, warningCount: result.warnings.length, durationMs: Date.now() - startedAt })
  return result
}
