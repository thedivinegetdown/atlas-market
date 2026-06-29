import { describe, expect, it } from 'vitest'
import { DEFAULT_TRADING_MODE, ORDER_SIDES } from '../lib/core/constants.js'
import { roundTo, clamp } from '../lib/core/math.js'
import { createErrorContract, createSuccessContract, isErrorContract } from '../lib/validation/errorContract.js'
import { validatePositiveNumber } from '../lib/validation/commonValidators.js'

describe('core utilities', () => {
  it('exports default paper-trading constants', () => {
    expect(DEFAULT_TRADING_MODE).toBe('paper')
    expect(ORDER_SIDES.BUY).toBe('buy')
  })

  it('rounds and clamps values safely', () => {
    expect(roundTo(1.005, 2)).toBe(1.01)
    expect(clamp(5, 1, 3)).toBe(3)
  })

  it('creates normalized validation contracts', () => {
    const error = validatePositiveNumber(0, 'amount')
    expect(isErrorContract(error)).toBe(true)
    expect(error.code).toBe('invalid_number')

    const success = createSuccessContract({ ok: true })
    expect(success.ok).toBe(true)
    expect(createErrorContract('boom', 'bad')).toEqual({ ok: false, code: 'boom', message: 'bad', details: null })
  })
})
