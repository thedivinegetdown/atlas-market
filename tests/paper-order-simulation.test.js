import { describe,expect,it,vi } from 'vitest'
import { simulateApprovedPaperEvaluations } from '../lib/opportunities/paperSimulation/index.js'
import { createPaperOrderSimulationHandler, edge2CohortFor } from '../netlify/functions/paper-order-simulation.js'
import { auth2Body, auth2Headers } from './helpers/auth2Fixtures.js'
const now='2026-08-09T12:00:00.000Z';const portfolio={id:'paper',cash:100000,equity:100000,buyingPower:100000,positions:[]};const portfolioRisk={account:{accountValue:100000,cash:100000,buyingPower:100000},summary:{openRisk:0,openRiskPct:0,drawdownPct:0}}
const executionQuote={symbol:'AAPL',price:100,bid:99.98,ask:100.02,bidSize:10000,askSize:10000,updatedAt:now,receivedAt:now,provider:'test-top-of-book',provenance:{provider:'test-top-of-book',dataStatus:'LIVE',fallbackUsed:false,receivedAt:now}}
function evaluation(overrides={}){return {evaluationId:'eval-1',candidateId:'candidate-1',symbol:'AAPL',strategyId:'momentum',status:'APPROVED_FOR_PAPER_REVIEW',freshness:'FRESH',evaluatedAt:now,evidenceFingerprint:'evidence-1',engineVersions:{tradeQuality:'trade-quality-v1'},orderContext:{assetType:'equity',side:'buy',orderType:'market',price:100,stopPrice:98},...overrides}}
function run(overrides={},options={}){return simulateApprovedPaperEvaluations({evaluations:[evaluation()],portfolio,portfolioRisk,enabled:true,executionQuotes:[executionQuote],...overrides},{now,confirmedAt:now,confirmationSource:'authenticated_manual_request',...options})}
describe('guarded paper order simulation',()=>{
 it('fails closed',()=>expect(simulateApprovedPaperEvaluations({evaluations:[evaluation()],portfolio,portfolioRisk},{now}).results).toEqual([]))
 it.each(['WATCH','REJECTED','STALE','INSUFFICIENT_DATA','ERROR'])('%s is ineligible',(status)=>expect(run({evaluations:[evaluation({status})]}).results).toEqual([]))
 it('requires explicit order context',()=>expect(run({evaluations:[evaluation({orderContext:{}})]}).results[0].status).toBe('INSUFFICIENT_ORDER_CONTEXT'))
 it('reuses sizing and risk but fails closed while execution calibration is unqualified',()=>{const x=run().results[0];expect(x.orderPlan.quantity).toBeGreaterThan(0);expect(x.guardrail.approved).toBe(true);expect(x.status).toBe('INSUFFICIENT_EXECUTION_EVIDENCE');expect(x.executionFill).toBeNull();expect(x).toMatchObject({paperTradingOnly:true,liveOrders:false,brokerExecution:false,automaticExecution:false,canonicalLedgerOutcome:{status:'NOT_COMMITTED'}})})
 it('rejects insufficient buying power',()=>expect(['INSUFFICIENT_ORDER_CONTEXT','SIMULATION_REJECTED']).toContain(run({portfolioRisk:{account:{accountValue:100000,cash:0,buyingPower:0},summary:{openRisk:0,openRiskPct:0}}}).results[0].status))
 it('enforces cycle and daily limits',()=>{const evaluations=Array.from({length:5},(_,i)=>evaluation({evaluationId:`e${i}`,candidateId:`c${i}`}));expect(run({evaluations}).results).toHaveLength(3);expect(run({evaluations,dailyCount:10}).results).toHaveLength(0)})
 it('suppresses duplicates but changed evidence proceeds',()=>{const first=run().results[0];expect(run({existingSimulations:[first]}).results[0].status).toBe('DUPLICATE_SUPPRESSED');expect(run({evaluations:[evaluation({evidenceFingerprint:'evidence-2'})],existingSimulations:[first]}).results[0].status).not.toBe('DUPLICATE_SUPPRESSED')})
 it('marks expired evidence stale',()=>expect(simulateApprovedPaperEvaluations({evaluations:[evaluation({evaluatedAt:'2026-08-01T00:00:00.000Z'})],portfolio,portfolioRisk,enabled:true},{now}).results[0].status).toBe('STALE'))
 it('stores no sensitive payload and calls no external subsystem',()=>{const spy=vi.fn();const x=run({provider:spy,broker:spy,ai:spy}).results[0];expect(spy).not.toHaveBeenCalled();expect(JSON.stringify(x)).not.toMatch(/rawCandles|apiKey|prompt|providerCredential/i)})
 it('never substitutes last price when executable bid/ask evidence is absent',()=>{const lastOnly={symbol:'AAPL',price:100,updatedAt:now,receivedAt:now,provider:'test',dataStatus:'LIVE',fallbackUsed:false};const x=run({executionQuotes:[lastOnly]}).results[0];expect(x.status).toBe('INSUFFICIENT_EXECUTION_EVIDENCE');expect(x.executionRealism.missingEvidence).toEqual(expect.arrayContaining(['authoritative_bid','authoritative_ask','authoritative_ask_size']));expect(x.executionFill).toBeNull()})
 it('records latency, spread, size and versioned assumptions without inventing a full fill',()=>{const decisionAt='2026-08-09T11:59:30.000Z';const x=run({evaluations:[evaluation({evaluatedAt:decisionAt})]}).results[0];expect(x.executionRealism).toMatchObject({version:'paper-execution-realism-v1',calibrationStatus:'UNQUALIFIED',evidenceStatus:'RECORDED_UNCALIBRATED',chronology:{decisionAt,confirmedAt:now,submittedAt:now,decisionToConfirmationMs:30000,confirmationToSubmissionMs:0},quoteEvidence:{bid:99.98,ask:100.02,spread:0.04,spreadBps:4},quantityEvidence:{fullQuantityDisplayed:true},deterministicAssumptions:{spreadTreatment:'preserve_quote_and_use_executable_side_once',costsTreatment:'existing_fee_and_slippage_models_once_after_calibration',fillModel:'fail_closed_until_calibrated'}});expect(x.executionFill).toBeNull();expect(x.blockers).toContain('External broker/live-fill calibration is required before paper fills can be simulated')})
})
describe('endpoint security',()=>{it('requires authenticated CSRF request',async()=>{const handler=createPaperOrderSimulationHandler({env:{PAPER_AUTOMATION_ENABLED:'true'}});expect((await handler({httpMethod:'POST',headers:auth2Headers({csrf:false}),body:JSON.stringify(auth2Body())})).statusCode).toBe(403)})})

describe('EDGE.2 durable cohort linkage',()=>{
 it('requires an exact persisted evaluation snapshot and approved exit definition',async()=>{
  const evaluated=evaluation({strategyId:'index-pullback-v1',evidenceFingerprint:'evidence-a'})
  const manifest={observationId:'edge-a',manifestFingerprint:'manifest-a',exitPolicy:{version:'index-pullback-exit-v1.0.0',policyFingerprint:'policy-a'}}
  const snapshot={experimentId:'EDGE.2',observationId:'edge-a',manifestFingerprint:'manifest-a',evaluationId:'eval-1',evaluationEvidenceFingerprint:'evidence-a',symbol:'AAPL',strategyId:'index-pullback-v1'}
  const repository={getForwardObservationManifest:vi.fn(async()=>({status:'collecting',manifest})),listForwardEvidenceSnapshots:vi.fn(async()=>[snapshot])}
  const simulation={exitPolicy:{version:manifest.exitPolicy.version,definitionFingerprint:'policy-a'}}
  await expect(edge2CohortFor(repository,{},evaluated,simulation)).resolves.toEqual({experimentId:'EDGE.2',observationId:'edge-a',manifestFingerprint:'manifest-a'})
  await expect(edge2CohortFor(repository,{},evaluated,{exitPolicy:{...simulation.exitPolicy,definitionFingerprint:'wrong'}})).resolves.toBeNull()
  await expect(edge2CohortFor({...repository,listForwardEvidenceSnapshots:async()=>[{...snapshot,evaluationId:'other'}]}, {}, evaluated, simulation)).resolves.toBeNull()
 })
})
