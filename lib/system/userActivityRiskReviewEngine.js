import { eventBus as defaultEventBus } from '../core/eventBus.js'
import { evaluateUserActivityTimeline } from './userActivityTimelineService.js'

export const SYSTEM_USER_ACTIVITY_RISK_REVIEW_EVALUATED_EVENT = 'system.userActivityRiskReview.evaluated'

const RISK_CATEGORIES = Object.freeze([
  'sensitive activity',
  'administrative change',
  'session anomaly',
  'notification pressure',
  'paper-trading operation',
])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function finding(id, category, severity, summary, references = []) {
  return { id, category, severity, summary, references }
}

function statusFrom(findings) {
  if (findings.some((item) => item.severity === 'critical')) return 'blocked'
  if (findings.some((item) => ['high', 'caution'].includes(item.severity))) return 'caution'
  return 'healthy'
}

function scoreFrom(findings) {
  const score = findings.reduce((total, item) => {
    if (item.severity === 'critical') return total + 35
    if (item.severity === 'high') return total + 25
    if (item.severity === 'caution') return total + 12
    return total + 4
  }, 0)
  return Math.min(100, score)
}

export function evaluateUserActivityRiskReview(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timeline = input.timeline ?? evaluateUserActivityTimeline(input, { emitEvent: false })
  const records = timeline.normalizedActivityRecords ?? []
  const notifications = input.notifications ?? []
  const findings = []

  for (const record of records) {
    if (record.category === 'session' && /revoked|expired|failed|blocked/i.test(record.summary)) {
      findings.push(finding(`session-anomaly-${record.id}`, 'session anomaly', 'caution', 'Non-active or blocked session activity requires review.', [record.id]))
    }
    if (['organization', 'team workspace', 'invitation'].includes(record.category)) {
      findings.push(finding(`admin-change-${record.id}`, 'administrative change', 'informational', 'Administrative activity included in operator review.', [record.id]))
    }
    if (record.category === 'paper-trading operation') {
      findings.push(finding(`paper-operation-${record.id}`, 'paper-trading operation', 'informational', 'Paper-trading operation included in activity review.', [record.id]))
    }
  }

  const criticalNotifications = notifications.filter((notification) => notification.severity === 'critical' && notification.status !== 'archived')
  if (criticalNotifications.length > 0) {
    findings.push(finding('critical-notification-pressure', 'notification pressure', 'high', 'Critical in-app notifications remain visible and require operator attention.', criticalNotifications.map((notification) => notification.id)))
  }
  if (timeline.sensitiveFieldRedaction?.tokens !== true || timeline.sensitiveFieldRedaction?.hashes !== true) {
    findings.push(finding('sensitive-redaction-gap', 'sensitive activity', 'critical', 'Activity timeline redaction controls are not fully asserted.'))
  }

  const riskScore = scoreFrom(findings)
  const status = statusFrom(findings)
  const result = {
    eventType: SYSTEM_USER_ACTIVITY_RISK_REVIEW_EVALUATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    riskCategories: RISK_CATEGORIES,
    activityRiskFindings: findings,
    activityRiskScore: riskScore,
    activityRiskStatus: status,
    timelineRecordCount: records.length,
    sensitiveFieldRedactionVerified: timeline.sensitiveFieldRedaction?.tokens === true
      && timeline.sensitiveFieldRedaction?.hashes === true
      && timeline.sensitiveFieldRedaction?.secrets === true,
    userScoped: timeline.userScoped,
    tenantScoped: timeline.tenantScoped,
    automaticSessionRevocation: false,
    automaticRoleChanges: false,
    automaticTradingActions: false,
    summary: `User activity risk review ${status}: ${findings.length} findings across ${records.length} timeline records.`,
    sourceEvents: {
      userActivityTimeline: timeline.eventType ?? null,
      inAppNotification: input.inAppNotificationCenter?.eventType ?? null,
      administrativeAudit: input.administrativeAudit?.eventType ?? null,
    },
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_USER_ACTIVITY_RISK_REVIEW_EVALUATED_EVENT, result)
  return result
}
