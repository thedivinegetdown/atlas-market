import { WorkspacePage } from '../../components/workspace/WorkspacePage.jsx'
import { OrderSections } from './orderSections.jsx'

export default function OrdersWorkspace() {
  return (
    <WorkspacePage title="Orders (Paper)" description="Execution simulation, accounting, trade journal, lifecycle, and order status. Paper trading only.">
      <OrderSections />
    </WorkspacePage>
  )
}

