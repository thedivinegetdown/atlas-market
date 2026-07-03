import { useEffect, useMemo, useState } from 'react'
import { portfolioRepository } from './tradingRuntime.js'

function ensurePortfolio() {
  const existing = portfolioRepository.list()[0]
  if (existing) return existing

  return portfolioRepository.create({
    id: 'portfolio-1',
    cash: 100000,
    exposure: 0.1,
    openPositions: [],
  })
}

export function usePortfolio() {
  const [portfolio, setPortfolio] = useState(() => ensurePortfolio())

  const refresh = () => {
    setPortfolio(ensurePortfolio())
  }

  useEffect(() => {
    refresh()
  }, [])

  const summary = useMemo(() => {
    const cash = Number(portfolio?.cash ?? 100000)
    return {
      accountValue: Number(portfolio?.accountValue ?? cash),
      cash,
      buyingPower: Number(portfolio?.buyingPower ?? cash),
      riskPct: Number(portfolio?.riskPct ?? 0),
      openPositions: portfolio?.openPositions ?? [],
    }
  }, [portfolio])

  return {
    portfolio,
    summary,
    refresh,
  }
}
