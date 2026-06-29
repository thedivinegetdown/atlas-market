import { useEffect, useMemo, useState } from 'react'
import { createPortfolioRepository } from '../../lib/repositories/portfolioRepository.js'
import { createPortfolioEngine } from '../../lib/portfolio/portfolioEngine.js'
import { createPerformanceEngine } from '../../lib/analytics/performanceEngine.js'
import { createEquityCurveEngine } from '../../lib/analytics/equityCurveEngine.js'

const portfolioRepository = createPortfolioRepository()
const portfolioEngine = createPortfolioEngine()
const performanceEngine = createPerformanceEngine()
const equityCurveEngine = createEquityCurveEngine()

export function usePortfolio() {
  const [portfolio, setPortfolio] = useState(null)

  useEffect(() => {
    const existing = portfolioRepository.list()[0]
    if (existing) {
      setPortfolio(existing)
      return
    }

    const created = portfolioRepository.create({
      id: 'portfolio-1',
      cash: 100000,
      exposure: 0.1,
      openPositions: [],
    })
    setPortfolio(created)
  }, [])

  const summary = useMemo(() => {
    const base = portfolio ?? { cash: 100000, exposure: 0.1 }
    const engineState = portfolioEngine.buildState({
      cash: Number(base.cash ?? 100000),
      positions: {},
      fills: [],
      quoteMap: {},
    })
    const performance = performanceEngine.summarize([])
    const maxDrawdown = equityCurveEngine.calculateMaxDrawdown([100000, 98000, 101000])

    return {
      accountValue: Number(engineState.equity ?? 100000),
      cash: Number(engineState.cash ?? 100000),
      buyingPower: Number(engineState.buyingPower ?? 100000),
      dailyReturn: 0.82,
      totalReturn: 2.4,
      winRate: performance.winRate,
      averageWinner: performance.averageWin,
      averageLoser: performance.averageLoss,
      profitFactor: performance.profitFactor,
      sharpeRatio: 1.42,
      maxDrawdown,
      expectancy: 1830,
      largestWinner: 4200,
      largestLoser: -1800,
      openRisk: 14200,
      riskPct: 1.2,
      openPositions: [],
      accountValueFormatted: '$100,000',
    }
  }, [portfolio])

  return {
    portfolio,
    summary,
    refresh: () => setPortfolio(portfolioRepository.list()[0] ?? null),
  }
}
