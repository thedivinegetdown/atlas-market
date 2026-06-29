import { useEffect, useMemo, useState } from 'react'
import { createRiskEngine } from '../../lib/risk/riskEngine.js'
import { createRiskRepository } from '../../lib/repositories/riskRepository.js'

const riskEngine = createRiskEngine()
const riskRepository = createRiskRepository()

function buildOrder(quote) {
  const price = Number(quote?.price ?? 100)
  return {
    symbol: quote?.symbol ?? 'SPY',
    type: 'LIMIT',
    side: 'BUY',
    quantity: 10,
    price,
  }
}

export function useRisk({ portfolio, quote } = {}) {
  const [version, setVersion] = useState(0)

  const risk = useMemo(() => {
    const order = buildOrder(quote)
    const decision = riskEngine.evaluateOrder(
      order,
      portfolio ?? { cash: 100000, exposure: 0.1 },
      quote ?? { price: order.price, updatedAt: new Date().toISOString() },
    )
    const notional = Number(order.quantity) * Number(order.price)
    const accountValue = Number(portfolio?.cash ?? 100000)
    const snapshot = {
      ...decision,
      symbol: order.symbol,
      positionSize: decision.adjustedQuantity || order.quantity,
      dollarRisk: Number((notional * 0.01).toFixed(2)),
      accountExposure: accountValue > 0 ? Number(((notional / accountValue) * 100).toFixed(2)) : 0,
      maxRisk: 1,
      stopDistance: Number((Number(order.price) * 0.02).toFixed(2)),
      rewardRatio: 2,
      dailyExposure: 0,
      portfolioRisk: Number((Number(portfolio?.exposure ?? 0) * 100).toFixed(2)),
    }

    return snapshot
  }, [portfolio, quote, version])

  useEffect(() => {
    riskRepository.create({
      symbol: risk.symbol ?? quote?.symbol ?? 'SPY',
      approved: risk.approved,
      reason: risk.reason,
      severity: risk.severity,
      checks: risk.checks,
    })
  }, [quote?.symbol, risk])

  return {
    risk,
    refresh: () => setVersion((current) => current + 1),
  }
}
