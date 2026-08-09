export const DEFAULT_DAILY_BRIEFING_CONFIG = Object.freeze({
  priorityLimit: 5,
  opportunityLimit: 3,
  thresholds: Object.freeze({ severeDrawdownPct: 20, elevatedDrawdownPct: 10, concentrationPct: 40, highOpportunityScore: 80, moderateOpportunityScore: 55 }),
  priorityOrder: Object.freeze({ CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFORMATIONAL: 4 }),
})
