import { useCallback, useEffect, useMemo, useState } from 'react'
import { createRiskEngine } from '../../lib/risk/riskEngine.js'
import { createPositionSizingEngine } from '../../lib/risk/positionSizingEngine.js'
import { createRiskLimits } from '../../lib/risk/riskLimits.js'
import { workspaceApiClient } from '../api/workspaceApiClient.js'

const limits = createRiskLimits()
const riskEngine = createRiskEngine({ limits })
const positionSizingEngine = createPositionSizingEngine({ limits })

function getAccountValue(portfolio, accountSummary) {
  return Number(accountSummary?.accountValue ?? portfolio?.accountValue ?? portfolio?.cash ?? 100000)
}

function buildRiskSnapshot({ quote, portfolio, accountSummary }) {
  if (!quote?.symbol) {
    return null
  }

  const price = Number(quote.price ?? 0)
  const accountValue = getAccountValue(portfolio, accountSummary)
  const maxRiskPerTrade = 1
  const stopDistance = Number((price * 0.02).toFixed(2))
  const stopPrice = Number((price - stopDistance).toFixed(2))
  const targetPrice = Number((price + (stopDistance * 2)).toFixed(2))
  const requestedPositionSize = positionSizingEngine.sizeOrder({
    accountBalance: accountValue,
    riskPerTrade: maxRiskPerTrade / 100,
    price,
    stopDistance,
  })
  const order = {
    symbol: quote.symbol,
    type: 'LIMIT',
    side: 'BUY',
    quantity: requestedPositionSize,
    price,
  }
  const decision = riskEngine.evaluateOrder(
    order,
    portfolio ?? { cash: accountValue, exposure: 0 },
    quote,
  )
  const positionSize = decision.approved ? requestedPositionSize : 0
  const evaluatedSize = positionSize || requestedPositionSize
  const notional = evaluatedSize * price
  const dollarRisk = Number((evaluatedSize * stopDistance).toFixed(2))
  const accountExposure = accountValue > 0 ? Number(((notional / accountValue) * 100).toFixed(2)) : 0
  const dailyExposure = Number((Math.min(accountExposure, 100) * 0.2).toFixed(2))
  const portfolioRisk = Number((Number(portfolio?.exposure ?? 0) * 100).toFixed(2))
  const buyingPower = Number(accountSummary?.buyingPower ?? portfolio?.buyingPower ?? accountValue)
  const buyingPowerImpact = buyingPower > 0 ? Number(((notional / buyingPower) * 100).toFixed(2)) : 0
  const failedCheck = decision.checks.find((check) => !check.passed)

  return {
    ...decision,
    symbol: quote.symbol,
    accountValue,
    maxRiskPerTrade,
    positionSize,
    requestedPositionSize,
    stopDistance,
    stopPrice,
    targetPrice,
    rewardRatio: stopDistance > 0 ? 2 : 0,
    dollarRisk,
    accountExposure,
    dailyExposure,
    portfolioRisk,
    buyingPowerImpact,
    warning: decision.approved ? null : failedCheck?.reason ?? decision.reason,
    calculatedAt: new Date().toISOString(),
  }
}

export function useRisk({ portfolio, accountSummary, quote } = {}) {
  const [version, setVersion] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [apiRisk, setApiRisk] = useState(null)
  const [apiError, setApiError] = useState(null)

  const result = useMemo(() => {
    try {
      return {
        risk: apiRisk ?? buildRiskSnapshot({ quote, portfolio, accountSummary }),
        error: null,
      }
    } catch (calculationError) {
      return {
        risk: null,
        error: calculationError instanceof Error ? calculationError.message : 'Unable to calculate risk',
      }
    }
  }, [accountSummary, apiRisk, portfolio, quote, version])

  useEffect(() => {
    setIsRefreshing(false)
  }, [result])

  const refresh = useCallback(async () => {
    const symbol = quote?.symbol
    if (!symbol) {
      setVersion((current) => current + 1)
      return null
    }

    setIsRefreshing(true)
    setApiError(null)
    try {
      const response = await workspaceApiClient.getRiskSummary(symbol)
      setApiRisk(response.risk)
      return response.risk
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unable to load risk summary')
      return null
    } finally {
      setIsRefreshing(false)
    }
  }, [quote?.symbol])

  return {
    risk: result.risk,
    activeSymbol: quote?.symbol ?? '',
    isLoading: false,
    isRefreshing,
    error: apiError ?? result.error,
    refresh,
  }
}
