import { describe,expect,it,vi } from 'vitest'
import { simulateApprovedPaperEvaluations } from '../lib/opportunities/paperSimulation/index.js'
import { createPaperOrderSimulationHandler } from '../netlify/functions/paper-order-simulation.js'
import { auth2Body, auth2Headers } from './helpers/auth2Fixtures.js'
const now='2026-08-09T12:00:00.000Z';const portfolio={id:'paper',cash:100000,equity:100000,buyingPower:100000,positions:[]};const portfolioRisk={account:{accountValue:100000,cash:100000,buyingPower:100000},summary:{openRisk:0,openRiskPct:0,drawdownPct:0}}
function evaluation(overrides={}){return {evaluationId:'eval-1',candidateId:'candidate-1',symbol:'AAPL',strategyId:'momentum',status:'APPROVED_FOR_PAPER_REVIEW',freshness:'FRESH',evaluatedAt:now,engineVersions:{tradeQuality:'trade-quality-v1'},orderContext:{assetType:'equity',side:'buy',orderType:'market',price:100,stopPrice:98},...overrides}}
function run(overrides={},options={}){return simulateApprovedPaperEvaluations({evaluations:[evaluation()],portfolio,portfolioRisk,enabled:true,...overrides},{now,...options})}
describe('guarded paper order simulation',()=>{
 it('fails closed',()=>expect(simulateApprovedPaperEvaluations({evaluations:[evaluation()],portfolio,portfolioRisk},{now}).results).toEqual([]))
 it.each(['WATCH','REJECTED','STALE','INSUFFICIENT_DATA','ERROR'])('%s is ineligible',(status)=>expect(run({evaluations:[evaluation({status})]}).results).toEqual([]))
 it('requires explicit order context',()=>expect(run({evaluations:[evaluation({orderContext:{}})]}).results[0].status).toBe('INSUFFICIENT_ORDER_CONTEXT'))
 it('reuses sizing and risk before atomic paper simulation',()=>{const x=run().results[0];expect(x.orderPlan.quantity).toBeGreaterThan(0);expect(x.guardrail.approved).toBe(true);expect(x.status).toBe('SIMULATED_FILLED');expect(x).toMatchObject({paperTradingOnly:true,liveOrders:false,brokerExecution:false,automaticExecution:false})})
 it('rejects insufficient buying power',()=>expect(['INSUFFICIENT_ORDER_CONTEXT','SIMULATION_REJECTED']).toContain(run({portfolioRisk:{account:{accountValue:100000,cash:0,buyingPower:0},summary:{openRisk:0,openRiskPct:0}}}).results[0].status))
 it('enforces cycle and daily limits',()=>{const evaluations=Array.from({length:5},(_,i)=>evaluation({evaluationId:`e${i}`,candidateId:`c${i}`}));expect(run({evaluations}).results).toHaveLength(3);expect(run({evaluations,dailyCount:10}).results).toHaveLength(0)})
 it('suppresses duplicates but changed evidence proceeds',()=>{const first=run().results[0];expect(run({existingSimulations:[first]}).results[0].status).toBe('DUPLICATE_SUPPRESSED');expect(run({evaluations:[evaluation({evaluatedAt:'2026-08-09T12:01:00.000Z'})],existingSimulations:[first]}).results[0].status).not.toBe('DUPLICATE_SUPPRESSED')})
 it('marks expired evidence stale',()=>expect(simulateApprovedPaperEvaluations({evaluations:[evaluation({evaluatedAt:'2026-08-01T00:00:00.000Z'})],portfolio,portfolioRisk,enabled:true},{now}).results[0].status).toBe('STALE'))
 it('stores no sensitive payload and calls no external subsystem',()=>{const spy=vi.fn();const x=run({provider:spy,broker:spy,ai:spy}).results[0];expect(spy).not.toHaveBeenCalled();expect(JSON.stringify(x)).not.toMatch(/rawCandles|apiKey|prompt|providerCredential/i)})
})
describe('endpoint security',()=>{it('requires authenticated CSRF request',async()=>{const handler=createPaperOrderSimulationHandler({env:{PAPER_AUTOMATION_ENABLED:'true'}});expect((await handler({httpMethod:'POST',headers:auth2Headers({csrf:false}),body:JSON.stringify(auth2Body())})).statusCode).toBe(403)})})
