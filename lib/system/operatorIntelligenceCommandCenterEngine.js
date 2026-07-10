import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_OPERATOR_INTELLIGENCE_COMMAND_CENTER_EVALUATED_EVENT = 'system.operatorIntelligenceCommandCenter.evaluated'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function statusFrom(input = {}) {
  if (input.operatorAttention?.status === 'blocked' || input.administrativeCases?.caseSummary?.critical > 0 || input.administrationWorkflowSla?.workflowSlaSummary?.breached > 0) return 'blocked'
  if (input.operatorAttention?.status === 'caution' || input.userActivityRiskReview?.activityRiskStatus === 'caution') return 'caution'
  return 'healthy'
}

export function evaluateOperatorIntelligenceCommandCenter(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const attentionQueue = input.operatorAttention?.rankedOperatorAttentionQueue ?? []
  const cases = input.administrativeCases?.administrativeCases ?? []
  const highRiskFindings = (input.userActivityRiskReview?.activityRiskFindings ?? []).filter((finding) => ['high', 'critical', 'caution'].includes(finding.severity))
  const status = statusFrom(input)
  const result = {
    eventType: SYSTEM_OPERATOR_INTELLIGENCE_COMMAND_CENTER_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    rankedAttentionQueueSummary: {
      total: attentionQueue.length,
      topItems: attentionQueue.slice(0, 5).map((item) => ({
        id: item.id,
        rank: item.rank,
        severity: item.severity,
        urgency: item.urgency,
        priorityScore: item.priorityScore,
        rationale: item.rationale,
      })),
    },
    openAdministrativeCases: {
      total: cases.filter((item) => ['open', 'investigating', 'monitoring'].includes(item.status)).length,
      critical: cases.filter((item) => item.priority === 'critical').length,
    },
    highRiskUserActivityFindings: {
      count: highRiskFindings.length,
      findings: highRiskFindings.slice(0, 5),
    },
    notificationDigestHealth: {
      status: input.notificationDigest?.status ?? 'healthy',
      unread: input.notificationDigest?.normalizedNotificationDigest?.unreadCount ?? 0,
      critical: input.notificationDigest?.normalizedNotificationDigest?.criticalCount ?? 0,
    },
    workflowSlaBreaches: input.administrationWorkflowSla?.workflowSlaSummary?.breached ?? 0,
    casesNearingDueDates: cases.filter((item) => item.dueDate && !['resolved', 'dismissed'].includes(item.status)).length,
    criticalUnresolvedFindings: attentionQueue.filter((item) => item.severity === 'critical').length,
    tenantAdministrationHealth: input.tenantAdministrationOperations?.operationalStatus ?? input.tenantOperationsHealth?.operationalStatus ?? 'healthy',
    safeSummariesOnly: true,
    sensitiveMaterialExcluded: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    commandCenterStatus: status,
    summary: `Operator Intelligence Command Center ${status}: ${attentionQueue.length} attention items, ${cases.length} cases, and ${highRiskFindings.length} risk findings summarized.`,
    sourceEvents: {
      operatorAttention: input.operatorAttention?.eventType ?? null,
      administrativeCases: input.administrativeCases?.eventType ?? null,
      userActivityRiskReview: input.userActivityRiskReview?.eventType ?? null,
      notificationDigest: input.notificationDigest?.eventType ?? null,
      administrationWorkflowSla: input.administrationWorkflowSla?.eventType ?? null,
      tenantAdministrationOperations: input.tenantAdministrationOperations?.eventType ?? null,
    },
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_OPERATOR_INTELLIGENCE_COMMAND_CENTER_EVALUATED_EVENT, result)
  return result
}
