import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { evaluateRealtimeScanner } from '../../lib/scanners/realTimeScannerOrchestrator.js'
import { evaluateRealtimeSignals } from '../../lib/signals/realTimeSignalEvaluationEngine.js'
import { createRealtimeAlerts } from '../../lib/alerts/realTimeAlertPipeline.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOperationsAccess(membership) {
  if (!['owner', 'admin', 'analyst', 'viewer'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Real-time scanner alert operations access denied', { statusCode: 403, publicMessage: 'real-time scanner alert operations access denied' })
}

export function createRealtimeScannerAlertOperationsHealthHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, membership, tenantContext }) => {
    assertOperationsAccess(membership)
    const realtimeScanner = options.realtimeScanner ?? evaluateRealtimeScanner({
      tenantContext,
      marketDataStreamingRouting: options.marketDataStreamingRouting,
    }, { emitEvent: false })
    const realtimeSignals = options.realtimeSignals ?? evaluateRealtimeSignals({
      tenantContext,
      realtimeScanner,
      researchSignalScore: options.researchSignalScore,
      marketRegimeClassification: options.marketRegimeClassification,
      portfolioRisk: options.portfolioRisk,
      strategyRuleEvaluation: options.strategyRuleEvaluation,
      strategySignalComposition: options.strategySignalComposition,
      multiTimeframeResearchContext: options.multiTimeframeResearchContext,
    }, { emitEvent: false })
    const realtimeAlerts = options.realtimeAlerts ?? createRealtimeAlerts({
      tenantContext,
      realtimeSignals,
      notificationPreferences: options.notificationPreferences,
    }, { emitEvent: false })
    const operationalStatus = realtimeScanner.scannerStatus === 'blocked' || realtimeSignals.signalEvaluationStatus === 'rejected'
      ? 'degraded'
      : realtimeAlerts.realtimeAlertSummary.critical > 0
        ? 'caution'
        : 'healthy'
    const realtimeScannerAlertOperations = {
      eventType: 'scanner.alertOperations.evaluated',
      operationalStatus,
      scannerSummary: realtimeScanner.realtimeScannerSummary,
      signalSummary: realtimeSignals.realtimeSignalSummary,
      alertSummary: realtimeAlerts.realtimeAlertSummary,
      sourceReferences: {
        scanner: realtimeScanner.eventType,
        signals: realtimeSignals.eventType,
        alerts: realtimeAlerts.eventType,
      },
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
      automaticTrading: false,
      summary: `Real-time scanner and alert operations ${operationalStatus}: scanner, signal, and alert pipeline reviewed.`,
    }
    return { event: apiFoundationEvent({ requestId, endpoint: 'realtime-scanner-alert-operations-health', status: operationalStatus }), realtimeScannerAlertOperations, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'realtime-scanner-alert-operations-health', ...options })
}

export const handler = createRealtimeScannerAlertOperationsHealthHandler()
