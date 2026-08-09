import { EquityCurvePanel, PositionsPanel, PortfolioSummaryPanel } from '../../components/panels.jsx'
import { MetricCard, WorkspacePanel } from '../../components/workspace/WorkspacePage.jsx'
import { useState } from 'react'
import { usePaperPositionExit } from '../../hooks/usePaperPositionExit.js'

export function PaperPositionExitPanel({state}={}){const live=usePaperPositionExit(),resolved=state??live;const[pending,setPending]=useState(null),[quantity,setQuantity]=useState('');const choose=(position,full)=>{setPending(position);setQuantity(String(full?position.quantity:Math.max(1,Math.floor(position.quantity/2))))};return <WorkspacePanel id="paper-position-exit" title="Paper Position Exit" subtitle="Manual simulated reductions and closes">
 <p><strong>PAPER ONLY</strong> · Human confirmation is required. No live broker is connected.</p>{resolved.isLoading?<p role="status">Loading or simulating paper position lifecycle…</p>:null}{resolved.error?<p role="alert">{resolved.error}</p>:null}
 {(resolved.positions??[]).map(position=><article key={position.positionId} className="strategy-manager-card"><h3>{position.symbol} · {position.side}</h3><p>Quantity: {position.quantity} · Average cost: ${position.averagePrice} · Reference: ${position.currentPrice} · Unrealized P&amp;L: ${position.unrealizedPnl??0}</p><button type="button" onClick={()=>choose(position,false)}>Reduce</button> <button type="button" onClick={()=>choose(position,true)}>Close</button></article>)}
 {!resolved.isLoading&&(resolved.positions??[]).length===0?<p>No eligible simulated paper positions.</p>:null}{pending?<div role="dialog" aria-label="Confirm simulated paper exit"><h3>Confirm PAPER ONLY exit for {pending.symbol}</h3><label>Exit quantity <input aria-label="Exit quantity" type="number" min="0" max={pending.quantity} value={quantity} onChange={e=>setQuantity(e.target.value)}/></label><p>Remaining quantity: {Math.max(0,Number(pending.quantity)-Number(quantity||0))} · Estimated realized P&amp;L before fees: ${((pending.side==='short'?pending.averagePrice-pending.currentPrice:pending.currentPrice-pending.averagePrice)*Number(quantity||0)).toFixed(2)}. Final fees and slippage use the simulator.</p><button type="button" onClick={async()=>{await resolved.exit(pending.positionId,Number(quantity));setPending(null)}}>Confirm Simulated Exit</button> <button type="button" onClick={()=>setPending(null)}>Cancel</button></div>:null}
 {resolved.result?<p role="status">Result: {String(resolved.result.status).replaceAll('_',' ')}{resolved.result.exitPlan?` · Realized P&L: $${resolved.result.exitPlan.realizedPnlDelta}`:''}</p>:null}</WorkspacePanel>}

export function PortfolioSections({ overview }) {
  return (
    <>
      <WorkspacePanel id="portfolio-summary" title="Portfolio Summary" subtitle="Paper account and P&L">
        <PortfolioSummaryPanel />
      </WorkspacePanel>
      <WorkspacePanel id="positions" title="Positions" subtitle="Open paper positions">
        <PositionsPanel activeSymbol="SPY" />
      </WorkspacePanel>
      <WorkspacePanel id="performance" title="Performance" subtitle="Equity curve">
        <EquityCurvePanel />
      </WorkspacePanel>
      <PaperPositionExitPanel />
      <WorkspacePanel id="analytics" title="Analytics" subtitle="Portfolio intelligence">
        <div className="metric-grid">
          <MetricCard label="Performance" value={overview.performance} />
          <MetricCard label="Analytics" value={overview.analytics} />
          <MetricCard label="Capital Allocation" value={overview.allocation} />
          <MetricCard label="Diversification" value={overview.diversification} />
        </div>
      </WorkspacePanel>
    </>
  )
}
