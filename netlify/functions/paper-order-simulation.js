import { createAtlasAiRepository } from '../../lib/ai/atlasAiGateway.js'
import { createWorkspaceDataService } from '../../lib/workspace/workspaceDataService.js'
import { simulateApprovedPaperEvaluations } from '../../lib/opportunities/paperSimulation/index.js'
import { requireAccountContext } from '../../lib/security/securityPolicyEngine.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'
import { savePaperEntryPosition } from '../../lib/opportunities/paperExit/paperPositionStore.js'

export function createPaperOrderSimulationHandler({repository:providedRepository,serviceFactory=createWorkspaceDataService,env=process.env,...options}={}) {
 return createOrganizationAuthenticatedApiHandler(async({body,tenantContext,user,repository:persistenceRepository})=>{
  const repository=providedRepository??createAtlasAiRepository(options); const accountId=requireAccountContext(body.accountId??'paper-portfolio'); const context={tenantContext,accountId,userId:tenantContext.userId??user.id}; const [evaluations,existing,portfolioResult]=await Promise.all([repository.listPaperEvaluations(context),repository.listPaperSimulations(context),serviceFactory().getPortfolioSummary()]); const summary=portfolioResult.summary??{}; const portfolio={id:accountId,cash:summary.cash,equity:summary.accountValue,buyingPower:summary.buyingPower,positions:[]}; const portfolioRisk={account:{accountValue:summary.accountValue,cash:summary.cash,buyingPower:summary.buyingPower},summary:{openRisk:summary.openRisk,openRiskPct:summary.accountValue?summary.openRisk/summary.accountValue*100:0,drawdownPct:summary.maxDrawdown}}
  const today=new Date().toISOString().slice(0,10); const dailyCount=existing.filter(x=>x.status==='SIMULATED_FILLED'&&String(x.simulatedAt).startsWith(today)).length; const result=simulateApprovedPaperEvaluations({evaluations,existingSimulations:existing,portfolio,portfolioRisk,enabled:String(env.PAPER_AUTOMATION_ENABLED??'false').toLowerCase()==='true',dailyCount})
  for(const simulation of result.results.filter(x=>x.status==='SIMULATED_FILLED')){await repository.savePaperSimulation({...context,simulation});await savePaperEntryPosition(persistenceRepository,simulation,tenantContext)}
  return {...result,manualTrigger:true,authenticated:true,processLocalDailyLimit:true}
 },{allowedMethods:['POST'],requiredPermission:'dashboard.read',workspaceAction:'read',routeId:'paper-order-simulation',maxRequestBytes:8*1024,...options})
}
export const handler=createPaperOrderSimulationHandler()
