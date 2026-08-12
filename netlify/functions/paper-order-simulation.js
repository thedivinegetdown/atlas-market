import { assertDurablePaperEvidenceWrite, resolveCanonicalPaperEvidenceRepository } from '../../lib/opportunities/persistence/canonicalPaperEvidenceRepository.js'
import { createWorkspaceDataService } from '../../lib/workspace/workspaceDataService.js'
import { simulateApprovedPaperEvaluations } from '../../lib/opportunities/paperSimulation/index.js'
import { requireAccountContext } from '../../lib/security/securityPolicyEngine.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'
import { savePaperEntryPosition } from '../../lib/opportunities/paperExit/paperPositionStore.js'

export function createPaperOrderSimulationHandler({repository:providedRepository,serviceFactory=createWorkspaceDataService,env=process.env,...options}={}) {
 return createOrganizationAuthenticatedApiHandler(async({body,tenantContext,user,repository:persistenceRepository})=>{
  const repository=resolveCanonicalPaperEvidenceRepository({opportunityRepository:providedRepository,persistenceRepository,env}); const accountId=requireAccountContext(body.accountId??'paper-portfolio'); const context={tenantContext,accountId,userId:tenantContext.userId??user.id}; const [evaluations,existing,portfolioResult]=await Promise.all([repository.listPaperEvaluations(context),repository.listPaperSimulations(context),serviceFactory().getPortfolioSummary()]); const summary=portfolioResult.summary??{}; const portfolio={id:accountId,cash:summary.cash,equity:summary.accountValue,buyingPower:summary.buyingPower,positions:[]}; const portfolioRisk={account:{accountValue:summary.accountValue,cash:summary.cash,buyingPower:summary.buyingPower},summary:{openRisk:summary.openRisk,openRiskPct:summary.accountValue?summary.openRisk/summary.accountValue*100:0,drawdownPct:summary.maxDrawdown}}
  const today=new Date().toISOString().slice(0,10); const dailyCount=existing.filter(x=>x.status==='SIMULATED_FILLED'&&String(x.simulatedAt).startsWith(today)).length; const result=simulateApprovedPaperEvaluations({evaluations,existingSimulations:existing,portfolio,portfolioRisk,enabled:String(env.PAPER_AUTOMATION_ENABLED??'false').toLowerCase()==='true',dailyCount})
  const results=[]; for(const simulation of result.results){if(!simulation.fingerprint){results.push(simulation);continue}const saved=assertDurablePaperEvidenceWrite(await repository.savePaperSimulation({...context,simulation}));if(saved.duplicate){results.push({...simulation,status:'DUPLICATE_SUPPRESSED',blockers:['Identical durable execution intent already exists']});continue}results.push(simulation);if(simulation.status==='SIMULATED_FILLED')await savePaperEntryPosition(persistenceRepository,simulation,tenantContext)}
  return {...result,results,manualTrigger:true,authenticated:true,durableExecutionIntent:true,accountingProjection:'compatibility-only-pending-pi3',processLocalDailyLimit:true}
 },{allowedMethods:['POST'],requiredPermission:'dashboard.read',workspaceAction:'read',routeId:'paper-order-simulation',maxRequestBytes:8*1024,env,...options})
}
export const handler=createPaperOrderSimulationHandler()
