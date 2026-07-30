const DAILY_ALIASES = new Set(['1D', 'D', 'DAY', 'DAILY', '1DAY'])
const REALTIME_ALIASES = new Set(['REALTIME', 'REAL_TIME', 'RT', 'QUOTE'])

export function normalizeRegimeTimeframe(value) {
  const normalized = String(value ?? '').trim().toUpperCase()
  if (DAILY_ALIASES.has(normalized)) return '1D'
  if (REALTIME_ALIASES.has(normalized)) return 'REALTIME'
  return normalized || null
}

export function validateRegimeTimeframe(field, timeframe, targetTimeframe = '1D') {
  const normalized = normalizeRegimeTimeframe(timeframe)
  const target = normalizeRegimeTimeframe(targetTimeframe)
  if (!normalized) return { compatible: false, timeframe: null, warning: `${field} has no timeframe metadata` }
  if (normalized === target) return { compatible: true, timeframe: normalized }
  if (field === 'price' && target === '1D' && normalized === 'REALTIME') {
    return { compatible: true, timeframe: normalized, derivedCompatibility: 'daily-current-price' }
  }
  return { compatible: false, timeframe: normalized, warning: `${field} timeframe ${normalized} is incompatible with ${target}` }
}
