export function nowTimestamp() {
  return Date.now()
}

export function toIsoString(timestamp) {
  return new Date(timestamp).toISOString()
}

export function secondsBetween(startTimestamp, endTimestamp) {
  return Math.max(0, Math.round((endTimestamp - startTimestamp) / 1000))
}
