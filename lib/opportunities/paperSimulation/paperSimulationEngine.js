import { createHash } from 'node:crypto'
import { evaluateTradeGuardrail } from '../../../src/core/risk/tradeGuardrailEngine.js'
import { recommendPositionSize } from '../../../src/core/risk/positionSizingEngine.js'
import { DEFAULT_PAPER_SIMULATION_CONFIG } from './paperSimulationConfig.js'
import { createIndexPullbackExitPolicy, INDEX_PULLBACK_STRATEGY_VERSION } from '../forwardTest/indexPullbackExitPolicy.js'

export const PAPER_SIMULATION_VERSION = 'guarded-paper-simulation-v2'
export const PAPER_EXECUTION_REALISM_VERSION = 'paper-execution-realism-v1'
export const PAPER_EXECUTION_CALIBRATION_STATUS = 'UNQUALIFIED'
export const PAPER_SIMULATION_STATUSES = Object.freeze(['SIMULATED_FILLED','SIMULATION_REJECTED','DUPLICATE_SUPPRESSED','STALE','INSUFFICIENT_ORDER_CONTEXT','INSUFFICIENT_EXECUTION_EVIDENCE','ERROR'])

const EXECUTION_QUOTE_MAX_AGE_MS = 30_000
const validSides = new Set(['buy','sell','short','cover'])
const finitePositive = (value) => Number.isFinite(Number(value)) && Number(value) > 0
const finiteOrNull = (value) => Number.isFinite(Number(value)) ? Number(value) : null

function compactQuoteEvidence(quote = {}, symbol) {
  const provenance = quote.provenance ?? {}
  return {
    symbol: String(quote.symbol ?? symbol ?? '').toUpperCase(),
    last: finiteOrNull(quote.last ?? quote.price),
    bid: finiteOrNull(quote.bid),
    ask: finiteOrNull(quote.ask),
    bidSize: finiteOrNull(quote.bidSize ?? quote.bid_size),
    askSize: finiteOrNull(quote.askSize ?? quote.ask_size),
    observedAt: quote.updatedAt ?? quote.timestamp ?? provenance.observedAt ?? null,
    receivedAt: quote.receivedAt ?? provenance.receivedAt ?? null,
    provider: quote.provider ?? provenance.provider ?? null,
    dataStatus: quote.dataStatus ?? provenance.dataStatus ?? null,
    fallbackUsed: quote.fallbackUsed ?? provenance.fallbackUsed ?? null,
  }
}

function buildExecutionRealism({ evaluation, plan, quote, confirmationAt, submittedAt, confirmationSource }) {
  const decisionAt = evaluation.evaluatedAt ?? null
  const decisionMs = Date.parse(decisionAt)
  const confirmationMs = Date.parse(confirmationAt)
  const submittedMs = Date.parse(submittedAt)
  const observedMs = Date.parse(quote.observedAt)
  const sideSize = plan.side === 'buy' || plan.side === 'cover' ? quote.askSize : quote.bidSize
  const spread = finitePositive(quote.bid) && finitePositive(quote.ask) && quote.ask >= quote.bid
    ? Number((quote.ask - quote.bid).toFixed(8))
    : null
  const spreadBps = spread !== null && finitePositive((quote.ask + quote.bid) / 2)
    ? Number(((spread / ((quote.ask + quote.bid) / 2)) * 10_000).toFixed(4))
    : null
  const missingEvidence = []

  if (!Number.isFinite(decisionMs)) missingEvidence.push('decision_timestamp')
  if (!Number.isFinite(confirmationMs)) missingEvidence.push('human_confirmation_timestamp')
  if (!Number.isFinite(submittedMs)) missingEvidence.push('simulated_order_submission_timestamp')
  if (Number.isFinite(decisionMs) && Number.isFinite(confirmationMs) && confirmationMs < decisionMs) missingEvidence.push('nonnegative_decision_confirmation_latency')
  if (Number.isFinite(confirmationMs) && Number.isFinite(submittedMs) && submittedMs < confirmationMs) missingEvidence.push('nonnegative_confirmation_submission_latency')
  if (!confirmationSource) missingEvidence.push('human_confirmation_source')
  if (!finitePositive(quote.bid)) missingEvidence.push('authoritative_bid')
  if (!finitePositive(quote.ask)) missingEvidence.push('authoritative_ask')
  if (finitePositive(quote.bid) && finitePositive(quote.ask) && quote.ask < quote.bid) missingEvidence.push('noncrossed_bid_ask')
  if (!finitePositive(sideSize)) missingEvidence.push(plan.side === 'buy' || plan.side === 'cover' ? 'authoritative_ask_size' : 'authoritative_bid_size')
  if (finitePositive(sideSize) && sideSize < plan.quantity) missingEvidence.push('displayed_size_for_full_quantity')
  if (!Number.isFinite(observedMs)) missingEvidence.push('quote_observed_timestamp')
  if (Number.isFinite(observedMs) && Number.isFinite(submittedMs) && (observedMs > submittedMs || submittedMs - observedMs > EXECUTION_QUOTE_MAX_AGE_MS)) missingEvidence.push('current_quote_evidence')
  if (!quote.receivedAt) missingEvidence.push('quote_received_timestamp')
  if (!quote.provider) missingEvidence.push('quote_provider')
  if (quote.dataStatus !== 'LIVE') missingEvidence.push('live_quote_provenance')
  if (quote.fallbackUsed !== false) missingEvidence.push('non_fallback_quote_provenance')

  return {
    version: PAPER_EXECUTION_REALISM_VERSION,
    calibrationStatus: PAPER_EXECUTION_CALIBRATION_STATUS,
    evidenceStatus: missingEvidence.length ? 'MISSING' : 'RECORDED_UNCALIBRATED',
    chronology: {
      decisionAt,
      confirmedAt: confirmationAt ?? null,
      submittedAt: submittedAt ?? null,
      decisionToConfirmationMs: Number.isFinite(decisionMs) && Number.isFinite(confirmationMs) ? confirmationMs - decisionMs : null,
      confirmationToSubmissionMs: Number.isFinite(confirmationMs) && Number.isFinite(submittedMs) ? submittedMs - confirmationMs : null,
      confirmationSource: confirmationSource ?? null,
    },
    quoteEvidence: { ...quote, spread, spreadBps },
    quantityEvidence: {
      requestedQuantity: plan.quantity,
      executableSide: plan.side === 'buy' || plan.side === 'cover' ? 'ask' : 'bid',
      displayedSize: sideSize,
      fullQuantityDisplayed: finitePositive(sideSize) ? sideSize >= plan.quantity : null,
    },
    deterministicAssumptions: {
      priceBasis: 'executable_side_quote_required',
      quantityModel: 'displayed_size_plus_empirical_fill_calibration_required',
      spreadTreatment: 'preserve_quote_and_use_executable_side_once',
      costsTreatment: 'existing_fee_and_slippage_models_once_after_calibration',
      fillModel: 'fail_closed_until_calibrated',
    },
    missingEvidence,
    blockers: [
      ...missingEvidence.map((name) => `Missing execution evidence: ${name}`),
      'External broker/live-fill calibration is required before paper fills can be simulated',
    ],
  }
}

function fingerprint(evaluation, plan, realism) {
  const quote = realism.quoteEvidence
  return createHash('sha256').update(JSON.stringify([
    evaluation.evaluationId,evaluation.candidateId,evaluation.strategyId,evaluation.evidenceFingerprint,
    evaluation.engineVersions?.tradeQuality,evaluation.evaluatedAt,plan.side,plan.quantity,plan.referencePrice,
    realism.version,quote.provider,quote.observedAt,quote.bid,quote.ask,quote.bidSize,quote.askSize,
  ])).digest('hex')
}

function insufficient(evaluation, blockers, extra = {}) {
  return {
    evaluationId:evaluation.evaluationId,candidateId:evaluation.candidateId,symbol:evaluation.symbol,
    strategyId:evaluation.strategyId,evaluationEvidenceFingerprint:evaluation.evidenceFingerprint??null,
    status:'INSUFFICIENT_ORDER_CONTEXT',blockers,paperTradingOnly:true,automaticExecution:false,
    liveOrders:false,brokerExecution:false,engineVersion:PAPER_SIMULATION_VERSION,...extra,
  }
}

export function simulateApprovedPaperEvaluations({ evaluations=[], existingSimulations=[], portfolio={}, portfolioRisk, enabled=false, dailyCount=0, executionQuotes=[] }={}, options={}) {
  const config=options.config ?? DEFAULT_PAPER_SIMULATION_CONFIG
  const now=options.now ?? new Date().toISOString()
  const confirmationAt=options.confirmedAt ?? null
  const confirmationSource=options.confirmationSource ?? null
  if (!enabled) return { status:'BLOCKED', killSwitchEnabled:false, cycleLimit:config.cycleLimit, dailyLimit:config.dailyLimit, results:[], blocker:'Paper automation kill switch is disabled', paperTradingOnly:true, automaticExecution:false }
  const remaining=Math.max(0,config.dailyLimit-dailyCount)
  const selected=evaluations.filter(e=>e.status==='APPROVED_FOR_PAPER_REVIEW').slice(0,Math.min(config.cycleLimit,remaining))
  const prior=new Set(existingSimulations.map(s=>s.fingerprint))
  const quotes=new Map(executionQuotes.map(quote=>[String(quote?.symbol??'').toUpperCase(),quote]))
  const results=[]
  for (const evaluation of selected) {
    const age=Date.parse(now)-Date.parse(evaluation.evaluatedAt)
    if (evaluation.freshness==='STALE'||!Number.isFinite(age)||age<0||age>config.maxEvidenceAgeMs) { results.push({...insufficient(evaluation,['Market evidence is stale']),status:'STALE'}); continue }
    const c=evaluation.orderContext ?? {}
    const missing=[]
    if(!validSides.has(c.side))missing.push('side')
    if(!finitePositive(c.price))missing.push('referencePrice')
    if(!finitePositive(c.stopPrice))missing.push('stopPrice')
    if(missing.length){results.push(insufficient(evaluation,missing.map(x=>`${x} is required`)));continue}
    const base={symbol:evaluation.symbol,assetType:c.assetType||'equity',side:c.side,orderType:c.orderType||'market',price:Number(c.price),stopPrice:Number(c.stopPrice),paperTrading:true}
    const sizing=recommendPositionSize(portfolio,base,{emitEvent:false,portfolioRisk,timestamp:now})
    const quantity=finitePositive(c.quantity)?Number(c.quantity):sizing.suggestedQuantity
    if(sizing.status!=='recommended'||!finitePositive(quantity)){results.push(insufficient(evaluation,[sizing.reason||'Position sizing did not produce a valid quantity']));continue}
    const proposedTrade={...base,quantity}
    const guardrail=evaluateTradeGuardrail(portfolio,proposedTrade,{emitEvent:false,currentRisk:portfolioRisk,timestamp:now})
    let exitPolicy=null
    if(evaluation.strategyId==='index-pullback-v1'){
      if(!finitePositive(c.targetPrice)){results.push(insufficient(evaluation,['targetPrice is required for the approved deterministic exit policy']));continue}
      try{exitPolicy=createIndexPullbackExitPolicy({strategyId:evaluation.strategyId,strategyVersion:INDEX_PULLBACK_STRATEGY_VERSION,strategyFingerprint:evaluation.strategyFingerprint??null,side:base.side,entryPrice:base.price,stopPrice:base.stopPrice,targetPrice:Number(c.targetPrice),enteredAt:evaluation.evaluatedAt})}catch(error){results.push(insufficient(evaluation,[error.message]));continue}
    }
    const plan={candidateId:evaluation.candidateId,evaluationId:evaluation.evaluationId,symbol:evaluation.symbol,assetType:base.assetType,strategyId:evaluation.strategyId,strategyVersion:evaluation.strategyId==='index-pullback-v1'?INDEX_PULLBACK_STRATEGY_VERSION:null,side:base.side,quantity,entryType:base.orderType,referencePrice:base.price,stopReference:base.stopPrice,targetReference:finitePositive(c.targetPrice)?Number(c.targetPrice):null,exitPolicy,maximumRisk:guardrail.metrics?.dollarRisk??null,evidenceTimestamp:evaluation.evaluatedAt,guardrailResult:{approved:guardrail.approved,reason:guardrail.reason},paperTradingOnly:true,liveTradingApproved:false}
    const quote=compactQuoteEvidence(quotes.get(String(evaluation.symbol??'').toUpperCase()),evaluation.symbol)
    const executionRealism=buildExecutionRealism({evaluation,plan,quote,confirmationAt,submittedAt:now,confirmationSource})
    const key=fingerprint(evaluation,plan,executionRealism)
    if(prior.has(key)){results.push({...insufficient(evaluation,['Identical evaluation and execution evidence were already simulated']),status:'DUPLICATE_SUPPRESSED',fingerprint:key,orderPlan:plan,executionRealism});continue}
    if(!guardrail.approved){results.push({...insufficient(evaluation,[guardrail.reason]),status:'SIMULATION_REJECTED',fingerprint:key,orderPlan:plan,guardrail,executionRealism,canonicalLedgerOutcome:{status:'NOT_COMMITTED',reason:'risk_guardrail_rejected'}});continue}
    results.push({
      ...insufficient(evaluation,executionRealism.blockers),
      status:'INSUFFICIENT_EXECUTION_EVIDENCE',fingerprint:key,orderPlan:plan,exitPolicy,
      strategyFingerprint:evaluation.strategyFingerprint??exitPolicy?.strategyFingerprint??null,
      policyFingerprint:exitPolicy?.definitionFingerprint??null,plannedRisk:guardrail.metrics?.dollarRisk??null,
      tradeQuality:evaluation.tradeQuality??null,regime:evaluation.regime??null,evaluationStatus:evaluation.status,
      guardrail:{approved:true,checks:guardrail.checks},executionRealism,executionFill:null,simulatedAt:now,
      canonicalLedgerOutcome:{status:'NOT_COMMITTED',reason:'execution_realism_unqualified'},
    })
  }
  return {status:results.some(r=>r.status==='SIMULATED_FILLED')?'COMPLETE':results.length?'CAUTION':'EMPTY',killSwitchEnabled:true,cycleLimit:config.cycleLimit,dailyLimit:config.dailyLimit,dailyRemaining:Math.max(0,remaining-results.filter(r=>r.status==='SIMULATED_FILLED').length),results,paperTradingOnly:true,automaticExecution:false}
}
