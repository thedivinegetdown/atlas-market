import { createHash } from 'node:crypto'
import { evaluateTradeGuardrail } from '../../../src/core/risk/tradeGuardrailEngine.js'
import { recommendPositionSize } from '../../../src/core/risk/positionSizingEngine.js'
import { simulateRealtimePaperExecution } from '../../trading/realTimeSimulatedExecutionCoordinator.js'
import { DEFAULT_PAPER_SIMULATION_CONFIG } from './paperSimulationConfig.js'
import { createIndexPullbackExitPolicy, INDEX_PULLBACK_STRATEGY_VERSION } from '../forwardTest/indexPullbackExitPolicy.js'
import {
  compactCurrentMarketEvidence,
  currentMarketEvidenceFingerprint,
  validateCurrentMarketEvidence,
  validateCurrentMarketEvidenceBundle,
} from '../../market/currentMarketEvidenceContract.js'

export const PAPER_SIMULATION_VERSION = 'guarded-paper-simulation-v3'
export const PAPER_EXECUTION_REALISM_VERSION = 'paper-execution-realism-v2'
export const PAPER_EXECUTION_CALIBRATION_STATUS = 'PAPER_ONLY_NOT_LIVE_CALIBRATED'
export const PAPER_SIMULATION_STATUSES = Object.freeze(['SIMULATED_FILLED','SIMULATION_REJECTED','DUPLICATE_SUPPRESSED','STALE','INSUFFICIENT_ORDER_CONTEXT','INSUFFICIENT_EXECUTION_EVIDENCE','ERROR'])

const EXECUTION_QUOTE_MAX_AGE_MS = 30_000
const validSides = new Set(['buy','sell','short','cover'])
const finitePositive = (value) => Number.isFinite(Number(value)) && Number(value) > 0
const finiteOrNull = (value) => Number.isFinite(Number(value)) ? Number(value) : null

function compactQuoteEvidence(quote = {}, symbol) {
  const evidence = compactCurrentMarketEvidence({
    quote: { ...quote, symbol: quote.symbol ?? symbol },
    provenance: quote.provenance,
  })
  return {
    ...evidence,
    symbol: String(evidence.symbol ?? '').toUpperCase(),
    last: evidence.price,
    liquidityScore: finiteOrNull(quote.liquidityScore),
  }
}

function buildExecutionRealism({ evaluation, plan, quote, confirmationAt, submittedAt, confirmationSource }) {
  const decisionAt = evaluation.evaluatedAt ?? null
  const decisionMs = Date.parse(decisionAt)
  const confirmationMs = Date.parse(confirmationAt)
  const submittedMs = Date.parse(submittedAt)
  const sideSize = plan.side === 'buy' || plan.side === 'cover' ? quote.askSize : quote.bidSize
  const spread = finitePositive(quote.bid) && finitePositive(quote.ask) && quote.ask >= quote.bid
    ? Number((quote.ask - quote.bid).toFixed(8))
    : null
  const spreadBps = spread !== null && finitePositive((quote.ask + quote.bid) / 2)
    ? Number(((spread / ((quote.ask + quote.bid) / 2)) * 10_000).toFixed(4))
    : null
  const missingEvidence = []
  const quoteProvenance = validateCurrentMarketEvidence(quote, { now: submittedAt, maxAgeMs: EXECUTION_QUOTE_MAX_AGE_MS })

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
  missingEvidence.push(...quoteProvenance.reasons.map((reason) => `execution_quote:${reason}`))

  const paperAdmissible = missingEvidence.length === 0
  return {
    version: PAPER_EXECUTION_REALISM_VERSION,
    calibrationStatus: PAPER_EXECUTION_CALIBRATION_STATUS,
    executionCalibrationStatus: PAPER_EXECUTION_CALIBRATION_STATUS,
    evidenceStatus: paperAdmissible ? 'SUFFICIENT_FOR_PAPER_SIMULATION' : 'MISSING',
    paperSimulationAdmissibility: {
      status: paperAdmissible ? 'ADMISSIBLE' : 'BLOCKED',
      basis: 'fresh_non_fallback_top_of_book_with_displayed_size',
    },
    liveExecutionCalibration: {
      status: 'NOT_CALIBRATED',
      liveMoneyReady: false,
      paperEvidenceMayAccumulate: true,
    },
    chronology: {
      decisionAt,
      confirmedAt: confirmationAt ?? null,
      submittedAt: submittedAt ?? null,
      decisionToConfirmationMs: Number.isFinite(decisionMs) && Number.isFinite(confirmationMs) ? confirmationMs - decisionMs : null,
      confirmationToSubmissionMs: Number.isFinite(confirmationMs) && Number.isFinite(submittedMs) ? submittedMs - confirmationMs : null,
      confirmationSource: confirmationSource ?? null,
    },
    recommendationEvidence: evaluation.currentMarketEvidence ?? null,
    recommendationEvidenceFingerprint: evaluation.currentMarketEvidenceFingerprint ?? null,
    quoteEvidence: { ...quote, spread, spreadBps },
    quoteEvidenceFingerprint: currentMarketEvidenceFingerprint(quote),
    quantityEvidence: {
      requestedQuantity: plan.quantity,
      executableSide: plan.side === 'buy' || plan.side === 'cover' ? 'ask' : 'bid',
      displayedSize: sideSize,
      fullQuantityDisplayed: finitePositive(sideSize) ? sideSize >= plan.quantity : null,
    },
    deterministicAssumptions: {
      priceBasis: 'executable_side_quote_required',
      quantityModel: 'full_fill_only_when_displayed_executable_size_covers_requested_quantity',
      spreadTreatment: 'preserve_quote_and_use_executable_side_once',
      costsTreatment: 'executable_side_then_slippage_once_and_fees_once',
      liquidityTreatment: quote.liquidityScore === null ? 'missing_score_uses_conservative_low_liquidity_penalty' : 'authoritative_score',
      fillModel: 'paper_top_of_book_displayed_size_v1',
    },
    missingEvidence,
    blockers: missingEvidence.map((name) => `Missing execution evidence: ${name}`),
  }
}

export function createPaperSimulationFingerprint(evaluation, plan, realism) {
  const quote = realism.quoteEvidence
  return createHash('sha256').update(JSON.stringify([
    evaluation.evaluationId,evaluation.candidateId,evaluation.strategyId,evaluation.evidenceFingerprint,
    plan.side,plan.quantity,plan.referencePrice,
    realism.version,realism.recommendationEvidenceFingerprint,realism.quoteEvidenceFingerprint,
    quote.provider,quote.observedAt,quote.receivedAt,quote.dataStatus,quote.fallbackUsed,quote.mock,quote.bid,quote.ask,quote.bidSize,quote.askSize,
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
    const recommendationProvenance=validateCurrentMarketEvidenceBundle(evaluation.currentMarketEvidence,{now:evaluation.evaluatedAt,maxAgeMs:5*60*1000})
    if(!recommendationProvenance.valid||evaluation.currentMarketEvidenceFingerprint!==recommendationProvenance.fingerprint){
      const provenanceBlockers=[...recommendationProvenance.reasons]
      if(evaluation.currentMarketEvidenceFingerprint!==recommendationProvenance.fingerprint)provenanceBlockers.push('recommendation:current_market_evidence_fingerprint_mismatch')
      results.push({...insufficient(evaluation,provenanceBlockers.map(reason=>`Current-market provenance rejected: ${reason}`)),status:'INSUFFICIENT_EXECUTION_EVIDENCE',currentMarketEvidence:evaluation.currentMarketEvidence??null,currentMarketEvidenceFingerprint:evaluation.currentMarketEvidenceFingerprint??null,executionFill:null,canonicalLedgerOutcome:{status:'NOT_COMMITTED',reason:'recommendation_provenance_insufficient'}})
      continue
    }
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
    const key=createPaperSimulationFingerprint(evaluation,plan,executionRealism)
    if(prior.has(key)){results.push({...insufficient(evaluation,['Identical evaluation and execution evidence were already simulated']),status:'DUPLICATE_SUPPRESSED',fingerprint:key,orderPlan:plan,executionRealism});continue}
    if(!guardrail.approved){results.push({...insufficient(evaluation,[guardrail.reason]),status:'SIMULATION_REJECTED',fingerprint:key,orderPlan:plan,guardrail,executionRealism,canonicalLedgerOutcome:{status:'NOT_COMMITTED',reason:'risk_guardrail_rejected'}});continue}
    if(executionRealism.paperSimulationAdmissibility.status!=='ADMISSIBLE'){
      results.push({
        ...insufficient(evaluation,executionRealism.blockers),
        status:'INSUFFICIENT_EXECUTION_EVIDENCE',fingerprint:key,orderPlan:plan,exitPolicy,
        strategyFingerprint:evaluation.strategyFingerprint??exitPolicy?.strategyFingerprint??null,
        policyFingerprint:exitPolicy?.definitionFingerprint??null,plannedRisk:guardrail.metrics?.dollarRisk??null,
        tradeQuality:evaluation.tradeQuality??null,regime:evaluation.regime??null,evaluationStatus:evaluation.status,
        guardrail:{approved:true,checks:guardrail.checks},executionRealism,executionFill:null,simulatedAt:now,
        executionCalibrationStatus:PAPER_EXECUTION_CALIBRATION_STATUS,
        canonicalLedgerOutcome:{status:'NOT_COMMITTED',reason:'paper_simulation_evidence_insufficient'},
      })
      continue
    }
    const prepared={id:`pa2-${evaluation.evaluationId}`,symbol:evaluation.symbol,assetType:base.assetType,preparationStatus:'ready',proposedPaperTrade:proposedTrade,guardrailEvaluation:{guardrailApproved:true},tradeGuardrailReference:{eventType:guardrail.eventType},buyingPowerValidation:{requiredCapital:guardrail.metrics.marginRequirement,buyingPower:guardrail.metrics.buyingPower},portfolioHeatValidation:{portfolioHeatAfterTrade:guardrail.metrics.portfolioHeatAfterTrade,maxPortfolioHeatPct:guardrail.metrics.maxPortfolioHeatPct},sourceDecisionReference:{id:evaluation.evaluationId,status:'approved'}}
    const execution=simulateRealtimePaperExecution({preparedTrades:[prepared],portfolio,quote:{last:quote.last,bid:quote.bid,ask:quote.ask,high:quote.ask,low:quote.bid,liquidityScore:quote.liquidityScore??0,timestamp:quote.observedAt},paperTrading:true,liveOrders:false,brokerExecution:false},{emitEvent:false,timestamp:now})
    const item=execution.realtimeSimulatedExecutions[0]
    const fill=item?.executionSimulation?.fill??null
    const position=item?.accountingUpdate?.positions?.find(value=>value.symbol===evaluation.symbol)
    const resolvedRealism={...executionRealism,fillEvidence:{status:fill?'PAPER_FILLED':'NOT_FILLED',requestedQuantity:plan.quantity,filledQuantity:fill?.quantity??0,referencePrice:fill?.referencePrice??null,fillPrice:fill?.fillPrice??null,spread:executionRealism.quoteEvidence.spread,spreadBps:executionRealism.quoteEvidence.spreadBps,slippageBps:fill?.slippageBps??null,slippageAmount:fill?.slippageAmount??null,fees:fill?.fees??null,costApplications:{spread:fill?1:0,slippage:fill?1:0,fees:fill?1:0}}}
    const filled=item?.executionLifecycleStatus==='simulated'
    results.push({evaluationId:evaluation.evaluationId,candidateId:evaluation.candidateId,symbol:evaluation.symbol,strategyId:evaluation.strategyId,strategyFingerprint:evaluation.strategyFingerprint??exitPolicy?.strategyFingerprint??null,policyFingerprint:exitPolicy?.definitionFingerprint??null,evaluationEvidenceFingerprint:evaluation.evidenceFingerprint??null,currentMarketEvidence:evaluation.currentMarketEvidence,currentMarketEvidenceFingerprint:evaluation.currentMarketEvidenceFingerprint,plannedRisk:guardrail.metrics?.dollarRisk??null,status:filled?'SIMULATED_FILLED':'SIMULATION_REJECTED',fingerprint:key,orderPlan:plan,exitPolicy,tradeQuality:evaluation.tradeQuality??null,regime:evaluation.regime??null,evaluationStatus:evaluation.status,guardrail:{approved:true,checks:guardrail.checks},simulation:{executionStatus:item?.executionLifecycleStatus,fillStatus:item?.executionSimulation?.finalStatus,accountingStatus:item?.accountingUpdate?.status,journalStatus:item?.journalRecord?.journalStatus,realizedPnl:Number.isFinite(Number(item?.journalRecord?.realizedPnl))?Number(item.journalRecord.realizedPnl):null},executionRealism:resolvedRealism,executionCalibrationStatus:PAPER_EXECUTION_CALIBRATION_STATUS,executionFill:fill?{...fill}:null,journal:item?.journalRecord?{tradeId:item.journalRecord.tradeId,journalStatus:item.journalRecord.journalStatus,realizedPnl:item.journalRecord.realizedPnl,decisionGate:item.journalRecord.decisionGate}:null,positionSnapshot:position?{positionId:`paper-position-${key.slice(0,24)}`,symbol:position.symbol,assetType:position.assetType,side:position.side,quantity:position.quantity,averagePrice:position.averagePrice,currentPrice:position.currentPrice,realizedPnl:position.realizedPnl??0,originatingCandidateId:evaluation.candidateId,originatingEvaluationId:evaluation.evaluationId,strategyId:evaluation.strategyId,exitPolicy}:null,accountSnapshot:item?.accountingUpdate?.account??null,canonicalLedgerOutcome:{status:filled?'PENDING_COMMIT':'NOT_COMMITTED',reason:filled?'paper_fill_admissible':'order_not_filled'},simulatedAt:now,paperTradingOnly:true,liveOrders:false,brokerExecution:false,automaticExecution:false,engineVersion:PAPER_SIMULATION_VERSION})
  }
  return {status:results.some(r=>r.status==='SIMULATED_FILLED')?'COMPLETE':results.length?'CAUTION':'EMPTY',killSwitchEnabled:true,cycleLimit:config.cycleLimit,dailyLimit:config.dailyLimit,dailyRemaining:Math.max(0,remaining-results.filter(r=>r.status==='SIMULATED_FILLED').length),results,paperTradingOnly:true,automaticExecution:false}
}
