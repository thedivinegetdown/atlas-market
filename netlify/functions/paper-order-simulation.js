import { assertDurablePaperEvidenceWrite, resolveCanonicalPaperEvidenceRepository } from '../../lib/opportunities/persistence/canonicalPaperEvidenceRepository.js'
import { resolveCanonicalPaperLedgerRepository } from '../../lib/opportunities/persistence/canonicalPaperLedgerRepository.js'
import { createWorkspaceDataService } from '../../lib/workspace/workspaceDataService.js'
import { simulateApprovedPaperEvaluations } from '../../lib/opportunities/paperSimulation/index.js'
import { requireAccountContext } from '../../lib/security/securityPolicyEngine.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

export async function edge2CohortFor(repository, context, evaluation, simulation) {
 if (evaluation.strategyId !== 'index-pullback-v1' || !evaluation.evidenceFingerprint) return null
 const persisted=await repository.getForwardObservationManifest?.({...context,experimentId:'EDGE.2'})
 if (persisted?.status!=='collecting' || !persisted.manifest?.manifestFingerprint) return null
 const manifest=persisted.manifest
 if (simulation.exitPolicy?.version!==manifest.exitPolicy?.version || simulation.exitPolicy?.definitionFingerprint!==manifest.exitPolicy?.policyFingerprint) return null
 const snapshots=await repository.listForwardEvidenceSnapshots?.({...context,observationId:manifest.observationId})??[]
 const matched=snapshots.find(snapshot=>snapshot.experimentId==='EDGE.2' && snapshot.observationId===manifest.observationId && snapshot.manifestFingerprint===manifest.manifestFingerprint && snapshot.evaluationId===evaluation.evaluationId && snapshot.evaluationEvidenceFingerprint===evaluation.evidenceFingerprint && snapshot.symbol===evaluation.symbol && snapshot.strategyId===evaluation.strategyId)
 return matched ? {experimentId:'EDGE.2',observationId:manifest.observationId,manifestFingerprint:manifest.manifestFingerprint} : null
}

export function createPaperOrderSimulationHandler({repository:providedRepository,ledgerRepository:providedLedgerRepository,serviceFactory=createWorkspaceDataService,env=process.env,...options}={}) {
 return createOrganizationAuthenticatedApiHandler(async({body,tenantContext,user,repository:persistenceRepository})=>{
  const repository=resolveCanonicalPaperEvidenceRepository({opportunityRepository:providedRepository,persistenceRepository,env})
  const ledger=resolveCanonicalPaperLedgerRepository({persistenceRepository,ledgerRepository:providedLedgerRepository,env})
  const accountId=requireAccountContext(body.accountId??'paper-portfolio')
  const context={tenantContext,accountId,userId:tenantContext.userId??user.id}
  const [evaluations,existing,portfolioResult]=await Promise.all([repository.listPaperEvaluations(context),repository.listPaperSimulations(context),serviceFactory().getPortfolioSummary()])
  const summary=portfolioResult.summary??{}
  const today=new Date().toISOString().slice(0,10)
  const dailyCount=existing.filter(x=>x.status==='SIMULATED_FILLED'&&String(x.simulatedAt).startsWith(today)).length
  const results=[]
  let envelope={status:'EMPTY',killSwitchEnabled:String(env.PAPER_AUTOMATION_ENABLED??'false').toLowerCase()==='true',cycleLimit:3,dailyLimit:10,dailyRemaining:Math.max(0,10-dailyCount),paperTradingOnly:true,automaticExecution:false}
  for(const evaluation of evaluations){
   if(results.length>=envelope.cycleLimit)break
   const durable=await ledger.getOrCreateAccount(context)
   const portfolio={id:accountId,cash:durable.account.cash,equity:durable.account.equity,buyingPower:durable.account.buyingPower,realizedPnl:durable.account.realizedPnl,positions:durable.positions}
   const portfolioRisk={account:{accountValue:durable.account.equity,cash:durable.account.cash,buyingPower:durable.account.buyingPower},summary:{openRisk:summary.openRisk??0,openRiskPct:durable.account.equity?Number(summary.openRisk??0)/durable.account.equity*100:0,drawdownPct:summary.maxDrawdown??0}}
   const cycle=simulateApprovedPaperEvaluations({evaluations:[evaluation],existingSimulations:[...existing,...results],portfolio,portfolioRisk,enabled:String(env.PAPER_AUTOMATION_ENABLED??'false').toLowerCase()==='true',dailyCount:dailyCount+results.filter(x=>x.status==='SIMULATED_FILLED').length})
   envelope={...cycle,results:undefined}
   const simulation=cycle.results[0]
   if(!simulation)continue
   if(!simulation.fingerprint){results.push(simulation);continue}
   const saved=assertDurablePaperEvidenceWrite(await repository.savePaperSimulation({...context,simulation}))
   if(simulation.status!=='SIMULATED_FILLED'){
    results.push(saved.duplicate?{...simulation,status:'DUPLICATE_SUPPRESSED',blockers:['Identical durable execution intent already exists']}:simulation)
    continue
   }
   // A prior intent may outlive a failed ledger transaction. The immutable ledger remains the accounting idempotency authority.
   const cohort=await edge2CohortFor(repository,context,evaluation,simulation)
   const committed=await ledger.commitEntry({...context,simulation:cohort?{...simulation,forwardObservation:cohort}:simulation})
   if(committed.duplicate){results.push({...simulation,status:'DUPLICATE_SUPPRESSED',blockers:['Identical durable paper execution already exists']});continue}
   results.push({...simulation,accountSnapshot:committed.account,positionSnapshot:committed.position,executionId:committed.execution.executionId,canonicalLedger:true})
  }
  const filled=results.filter(x=>x.status==='SIMULATED_FILLED').length
  return {...envelope,status:filled?'COMPLETE':results.length?'CAUTION':envelope.status,results,dailyRemaining:Math.max(0,(envelope.dailyLimit??10)-dailyCount-filled),manualTrigger:true,authenticated:true,durableExecutionIntent:true,accountingProjection:'canonical-postgresql-pi3',processLocalDailyLimit:true}
 },{allowedMethods:['POST'],requiredPermission:'dashboard.read',workspaceAction:'read',routeId:'paper-order-simulation',maxRequestBytes:8*1024,env,...options})
}
export const handler=createPaperOrderSimulationHandler()
