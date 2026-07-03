import { createRiskLimits } from './riskLimits.js'
import { resolveOrderAsset, validateAssetQuantity } from '../assets/index.js'

export function createRiskEngine({ limits = createRiskLimits(), killSwitch = false } = {}) {
  return {
    evaluateOrder(order, portfolio = {}, quote = {}) {
      const checks = []
      const now = Date.now()
      const quoteUpdatedAt = Number(quote?.updatedAt ? new Date(quote.updatedAt).getTime() : 0)
      const isStale = Boolean(quoteUpdatedAt) && now - quoteUpdatedAt > limits.staleMarketDataSeconds * 1000
      const quantity = Number(order?.quantity ?? 0)
      const price = Number(order?.price ?? 0)
      const asset = resolveOrderAsset(order, quote)
      const notional = asset.notional
      const exposure = Number(portfolio?.exposure ?? 0)

      if (killSwitch) {
        checks.push({ name: 'killSwitch', passed: false, reason: 'kill switch active' })
      } else {
        checks.push({ name: 'killSwitch', passed: true, reason: 'kill switch inactive' })
      }

      const quantityValidation = validateAssetQuantity(quantity, asset.profile)
      if (quantityValidation.ok) {
        checks.push({ name: 'quantity', passed: true, reason: `${asset.quantityLabel} quantity is valid` })
      } else {
        checks.push({ name: 'quantity', passed: false, reason: quantityValidation.message })
      }

      if (Number.isFinite(price) && price > 0) {
        checks.push({ name: 'price', passed: true, reason: 'price is valid' })
      } else {
        checks.push({ name: 'price', passed: false, reason: 'price must be greater than zero' })
      }

      if (notional <= limits.maxOrderNotional) {
        checks.push({ name: 'orderNotional', passed: true, reason: 'order notional within limit' })
      } else {
        checks.push({ name: 'orderNotional', passed: false, reason: 'order notional exceeds limit' })
      }

      if (exposure <= limits.maxPortfolioExposure) {
        checks.push({ name: 'portfolioExposure', passed: true, reason: 'portfolio exposure within limit' })
      } else {
        checks.push({ name: 'portfolioExposure', passed: false, reason: 'portfolio exposure exceeds limit' })
      }

      if (!isStale) {
        checks.push({ name: 'marketDataFreshness', passed: true, reason: 'quote is fresh' })
      } else {
        checks.push({ name: 'marketDataFreshness', passed: false, reason: 'quote is stale' })
      }

      const approved = checks.every((check) => check.passed)
      const severity = approved ? 'info' : 'high'
      const reason = approved ? 'order approved' : checks.find((check) => !check.passed)?.reason ?? 'order blocked'

      return {
        approved,
        reason,
        severity,
        checks,
        adjustedQuantity: approved ? quantity : 0,
        assetType: asset.assetType,
        quantityLabel: asset.quantityLabel,
        notional,
        contractMultiplier: asset.profile.contractMultiplier,
        margin: asset.margin,
        evaluatedAt: new Date(now).toISOString(),
      }
    },
  }
}
