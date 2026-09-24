// Controlled fixtures only; these rows are not market or production evidence.
export function canonicalHistory(pnls = [120, -40, 60, 0, 80]) {
  const executions = pnls.flatMap((netPnl, index) => {
    const at = (hour) => new Date(Date.UTC(2025, 0, index + 1, hour)).toISOString()
    const common = {
      accountRecordId: 'fixture-scoped-account', accountId: 'paper-test',
      positionId: `position-${index}`, symbol: 'SPY', strategyId: 'index-pullback-v1',
      quantity: 10, fees: 1, slippageBps: 5, engineVersion: 'fixture-v1', paperTradingOnly: true,
      payload: {
        assetType: 'etf', plannedRisk: 20,
        attribution: { strategyFingerprint: 'frozen-strategy', policyFingerprint: 'frozen-policy', evaluationFingerprint: `evaluation-${index}` },
      },
    }
    return [
      { ...common, executionId: `entry-${index}`, executionType: 'entry', side: 'buy', fillPrice: 100, cashImpact: -1001, realizedPnlDelta: 0, evidenceTimestamp: at(14), createdAt: at(14) },
      { ...common, executionId: `close-${index}`, executionType: 'close', side: 'sell', fillPrice: (1002 + netPnl) / 10, cashImpact: 1001 + netPnl, realizedPnlDelta: netPnl, evidenceTimestamp: at(15), createdAt: at(15) },
    ]
  })
  return { executions, history: { status: 'COMPLETE', returnedCount: executions.length, hasEarlier: false, latest: true } }
}

export function monteCarloInput(pnls) {
  return { canonicalExecutionHistory: canonicalHistory(pnls), startingEquity: 100000, outcomeCutoff: '2025-02-01T00:00:00.000Z', simulationCount: 25, seed: 7 }
}
