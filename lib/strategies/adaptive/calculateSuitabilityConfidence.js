function clamp(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)))
}

export function calculateSuitabilityConfidence({
  regimeConfidence,
  regimeStatus,
  missingInputs = [],
  lifecycleState,
  config,
}) {
  let confidence = Number(regimeConfidence) || 0
  confidence -= missingInputs.length * config.missingInputPenalty
  if (regimeStatus === 'PARTIAL') confidence -= config.partialRegimePenalty
  if (lifecycleState === 'validated') confidence -= config.validatedLifecyclePenalty
  return clamp(confidence)
}
