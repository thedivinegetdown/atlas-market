# Paper Position Exit and Realized P&L Lifecycle

Version: `paper-exit-v1`

PA.4 completes an existing simulated paper position through an explicit authenticated, CSRF-protected operator action. It has no timer, scheduler, AI trigger, live broker, or route-mount mutation.

## Authoritative position and trigger

New PA.2 fills retain the existing accounting engine's position and account snapshots in Atlas's tenant-scoped `operatorActions` persistence store. Each position is a single aggregate containing entry/evaluation linkage, current position/accounting state, and compact exit/journal records. Historical PA.2 audits without this snapshot cannot be reconstructed and remain ineligible.

The Portfolio workspace offers **Reduce** and **Close** controls behind a confirmation dialog. The server retrieves one fresh quote through the existing market-data service only after confirmation. Evidence older than five minutes fails closed.

## Exit calculation

Long positions exit with `sell`; supported short positions exit with `cover`. Quantity must be positive and cannot exceed the current position. A full close uses the entire quantity; a reduction must leave a positive remainder. Reversal is prohibited.

The existing execution simulator determines fill price, fees, and slippage. The existing paper accounting engine preserves average cost on the remaining position and calculates cash impact, realized P&L delta, cumulative realized P&L, and `position_reduced` or `position_closed`. The existing journal engine records the normalized lifecycle and originating evaluation linkage. No parallel P&L formula was introduced.

## Duplicate and atomicity boundary

The fingerprint includes position, quantity, quote timestamp, reference price, and closing side. An identical request cannot apply accounting twice. Position, account, exit, and journal summaries are written as one aggregate document, preventing partial writes within a request.

The current generic persistence store does not provide compare-and-swap version checks. Two truly concurrent requests against the same position may race between read and aggregate upsert. PA.4 does not claim distributed serializability; operators should submit one confirmed exit at a time. Adding optimistic concurrency is a future persistence decision.

Completed reductions and closes are consumed automatically by PA.3. Opening fills remain excluded until explicit realized P&L exists. Everything remains paper-only and advisory; no strategy, score, regime, scanner, risk, or live-trading behavior changes.
