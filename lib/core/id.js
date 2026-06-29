export function createId(prefix = 'id') {
  const randomPart = Math.random().toString(36).slice(2, 10)
  const timePart = Date.now().toString(36)
  return `${prefix}-${timePart}-${randomPart}`
}

export function createShortId(prefix = 'id') {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`
}
