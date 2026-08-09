import { createAtlasAiRepository } from '../../lib/ai/atlasAiGateway.js'
import { reviewPaperPerformance } from '../../lib/analytics/paperPerformanceReview.js'
import { requireAccountContext } from '../../lib/security/securityPolicyEngine.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function toPerformanceRecord(item={}){return{id:item.fingerprint??item.evaluationId,evaluationId:item.evaluationId,symbol:item.symbol,strategyId:item.strategyId,status:item.status,assetType:item.orderPlan?.assetType,simulatedAt:item.simulatedAt,tradeQuality:item.tradeQuality,regime:item.regime,evaluationStatus:item.evaluationStatus,accountingStatus:item.simulation?.accountingStatus,realizedPnl:item.simulation?.realizedPnl,paperTradingOnly:true}}
export function createPaperPerformanceReviewHandler({repository:providedRepository,...options}={}){return createOrganizationAuthenticatedApiHandler(async({query,tenantContext,user})=>{const repository=providedRepository??createAtlasAiRepository(options);const accountId=requireAccountContext(query.accountId??'paper-portfolio');const simulations=await repository.listPaperSimulations({tenantContext,accountId,userId:tenantContext.userId??user.id});return reviewPaperPerformance(simulations.map(toPerformanceRecord),{asOf:query.asOf})},{allowedMethods:['GET'],requiredPermission:'dashboard.read',workspaceAction:'read',routeId:'paper-performance-review',...options})}
export const handler=createPaperPerformanceReviewHandler()
