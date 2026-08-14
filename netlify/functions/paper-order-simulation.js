import { assertDurablePaperEvidenceWrite, resolveCanonicalPaperEvidenceRepository } from '../../lib/opportunities/persistence/canonicalPaperEvidenceRepository.js'
import { resolveCanonicalPaperLedgerRepository } from '../../lib/opportunities/persistence/canonicalPaperLedgerRepository.js'
import { createWorkspaceDataService } from '../../lib/workspace/workspaceDataService.js'
import { simulateApprovedPaperEvaluations } from '../../lib/opportunities/paperSimulation/index.js'
import { requireAccountContext } from '../../lib/security/securityPolicyEngine.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

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
   const committed=await ledger.commitEntry({...context,simulation})
   if(committed.duplicate){results.push({...simulation,status:'DUPLICATE_SUPPRESSED',blockers:['Identical durable paper execution already exists']});continue}
   results.push({...simulation,accountSnapshot:committed.account,positionSnapshot:committed.position,executionId:committed.execution.executionId,canonicalLedger:true})
  }
  const filled=results.filter(x=>x.status==='SIMULATED_FILLED').length
  return {...envelope,status:filled?'COMPLETE':results.length?'CAUTION':envelope.status,results,dailyRemaining:Math.max(0,(envelope.dailyLimit??10)-dailyCount-filled),manualTrigger:true,authenticated:true,durableExecutionIntent:true,accountingProjection:'canonical-postgresql-pi3',processLocalDailyLimit:true}
 },{allowedMethods:['POST'],requiredPermission:'dashboard.read',workspaceAction:'read',routeId:'paper-order-simulation',maxRequestBytes:8*1024,env,...options})
}
export const handler=createPaperOrderSimulationHandler()
