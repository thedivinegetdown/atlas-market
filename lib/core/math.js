export function roundTo(value, decimals = 2) {
  const normalized = Number(value)
  if (!Number.isFinite(normalized)) {
    return Number.NaN
  }

  const factor = 10 ** decimals
  const scaledValue = `${normalized}e${decimals}`
  const rounded = Math.round(Number(scaledValue))
  return Number(`${rounded}e-${decimals}`)
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

export function safeDivide(numerator, denominator, fallback = 0) {
  if (denominator === 0 || Number.isNaN(denominator)) {
    return fallback
  }

  return numerator / denominator
}
