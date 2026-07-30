export function buildRegimeReasons(...results) {
  const reasons = []
  for (const result of results) {
    for (const item of result?.evidence ?? []) if (item.reason && !reasons.includes(item.reason)) reasons.push(item.reason)
  }
  return reasons
}
