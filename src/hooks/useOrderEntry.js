import { useEffect, useMemo, useState } from 'react'
import { useOrders } from './useOrders.js'

const initialForm = {
  symbol: 'AAPL',
  orderIntent: 'BUY_LIMIT',
  quantity: '1',
  limitPrice: '100',
  stopPrice: '98',
  riskPct: '1',
  timeInForce: 'DAY',
}

function getIntentParts(orderIntent) {
  const [side, ...typeParts] = String(orderIntent ?? 'BUY_MARKET').split('_')
  return {
    side,
    type: typeParts.join('_'),
  }
}

function getExecutionPrice(form, quote) {
  const { type } = getIntentParts(form.orderIntent)
  if (type === 'MARKET') return Number(quote?.price ?? 0)
  if (type === 'STOP') return Number(form.stopPrice)
  return Number(form.limitPrice)
}

function validateForm(form, quote) {
  const errors = {}
  const { type } = getIntentParts(form.orderIntent)

  if (!form.symbol?.trim()) {
    errors.symbol = 'Symbol is required'
  }

  if (Number(form.quantity) <= 0) {
    errors.quantity = 'Quantity must be greater than zero'
  }

  if (Number(form.riskPct) <= 0) {
    errors.riskPct = 'Risk % must be greater than zero'
  }

  if (type === 'MARKET' && Number(quote?.price ?? 0) <= 0) {
    errors.price = 'A market price is required'
  }

  if ((type === 'LIMIT' || type === 'STOP_LIMIT') && Number(form.limitPrice) <= 0) {
    errors.limitPrice = 'Limit price must be greater than zero'
  }

  if ((type === 'STOP' || type === 'STOP_LIMIT') && Number(form.stopPrice) <= 0) {
    errors.stopPrice = 'Stop price must be greater than zero'
  }

  return errors
}

function buildPayload(form, quote) {
  const { side, type } = getIntentParts(form.orderIntent)
  return {
    symbol: form.symbol.trim().toUpperCase(),
    type,
    side,
    quantity: Number(form.quantity),
    price: getExecutionPrice(form, quote),
    limitPrice: Number(form.limitPrice || 0),
    stopPrice: Number(form.stopPrice || 0),
    riskPct: Number(form.riskPct),
    timeInForce: form.timeInForce,
  }
}

export function useOrderEntry({ activeSymbol, quote, portfolio, submitOrder } = {}) {
  const orders = useOrders()
  const [form, setForm] = useState(() => ({
    ...initialForm,
    symbol: activeSymbol ?? quote?.symbol ?? initialForm.symbol,
    limitPrice: quote?.price ? String(quote.price) : initialForm.limitPrice,
    stopPrice: quote?.price ? String(Number((Number(quote.price) * 0.98).toFixed(2))) : initialForm.stopPrice,
  }))
  const [preview, setPreview] = useState(null)
  const [validationErrors, setValidationErrors] = useState({})
  const [notification, setNotification] = useState(null)

  useEffect(() => {
    const nextSymbol = activeSymbol ?? quote?.symbol
    if (!nextSymbol) return

    setForm((current) => ({
      ...current,
      symbol: nextSymbol,
      limitPrice: current.limitPrice || (quote?.price ? String(quote.price) : ''),
      stopPrice: current.stopPrice || (quote?.price ? String(Number((Number(quote.price) * 0.98).toFixed(2))) : ''),
    }))
  }, [activeSymbol, quote])

  const payload = useMemo(() => buildPayload(form, quote), [form, quote])

  const updateField = (name, value) => {
    setForm((current) => ({ ...current, [name]: value }))
    setValidationErrors((current) => {
      const next = { ...current }
      delete next[name]
      return next
    })
  }

  const validate = (nextForm = form) => {
    const nextErrors = validateForm(nextForm, quote)
    setValidationErrors(nextErrors)
    return nextErrors
  }

  const previewOrder = (nextForm = form) => {
    const nextErrors = validate(nextForm)
    if (Object.keys(nextErrors).length > 0) {
      setPreview(null)
      setNotification({ type: 'error', message: 'Fix validation errors before previewing the order.' })
      return null
    }

    const nextPayload = buildPayload(nextForm, quote)
    const nextPreview = {
      ...nextPayload,
      notional: Number((nextPayload.quantity * nextPayload.price).toFixed(2)),
    }
    setPreview(nextPreview)
    setNotification(null)
    return nextPreview
  }

  const resetForm = () => {
    setForm({
      ...initialForm,
      symbol: activeSymbol ?? quote?.symbol ?? initialForm.symbol,
      limitPrice: quote?.price ? String(quote.price) : initialForm.limitPrice,
      stopPrice: quote?.price ? String(Number((Number(quote.price) * 0.98).toFixed(2))) : initialForm.stopPrice,
    })
    setPreview(null)
    setValidationErrors({})
  }

  const submit = async (nextForm = form) => {
    const nextErrors = validate(nextForm)
    if (Object.keys(nextErrors).length > 0) {
      setNotification({ type: 'error', message: 'Order validation failed.' })
      return { order: null, error: { message: 'Order validation failed.', details: nextErrors } }
    }

    const nextPayload = buildPayload(nextForm, quote)
    const submission = submitOrder ?? orders.submitOrder
    const result = await submission(nextPayload, quote ?? { price: nextPayload.price, updatedAt: new Date().toISOString() }, portfolio)

    if (result?.error) {
      setNotification({ type: 'error', message: `Pending risk review failed: ${nextPayload.symbol} ${result.error.message}` })
      return result
    }

    const status = result.order?.state === 'WORKING' ? 'Pending' : result.order?.state ?? 'Submitted'
    setNotification({ type: 'success', message: `${status}: ${nextPayload.side} ${nextPayload.quantity} ${nextPayload.symbol} paper order submitted.` })
    resetForm()
    void orders.refresh()
    return result
  }

  return {
    form,
    payload,
    preview,
    validationErrors,
    notification,
    updateField,
    validate,
    previewOrder,
    submit,
    resetForm,
  }
}
