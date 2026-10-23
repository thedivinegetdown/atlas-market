// Reject before compact/allowlist normalization can discard authority markings.
export function assertNotProvisionalEvidence(value) {
  const seen = new Set()
  function visit(item) {
    if (typeof item === 'string' && /PROVISIONAL_RESEARCH|provisional-research-v1/.test(item)) throw new Error('Provisional Research cannot be promoted into governed evidence')
    if (!item || typeof item !== 'object' || seen.has(item)) return
    seen.add(item)
    if (Object.hasOwn(item, 'provisionalResearch')) throw new Error('Provisional Research cannot be promoted into governed evidence')
    Object.values(item).forEach(visit)
  }
  visit(value)
}
