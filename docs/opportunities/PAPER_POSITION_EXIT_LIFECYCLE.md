# Paper Position Exit and Realized P&L Lifecycle

Version: `paper-exit-v1`

PA.4 completes an existing simulated paper position through an explicit authenticated, CSRF-protected operator action. It has no timer, scheduler, AI trigger, live broker, or route-mount mutation.

## Authoritative position and trigger

New PA.2 fills write the PI.3 canonical PostgreSQL account, immutable execution, and account-scoped position projection. Entry/evaluation linkage is retained in the execution and position rows. The former tenant-scoped `operatorActions` aggregate remains compatibility-only.

The Portfolio workspace offers **Reduce** and **Close** controls behind a confirmation dialog. The server retrieves one fresh quote through the existing market-data service only after confirmation. Evidence older than five minutes fails closed.

## Exit calculation

Long positions exit with `sell`; supported short positions exit with `cover`. Quantity must be positive and cannot exceed the current position. A full close uses the entire quantity; a reduction must leave a positive remainder. Reversal is prohibited.

The existing execution simulator determines fill price, fees, and slippage. The existing paper accounting engine preserves average cost on the remaining position and calculates cash impact, realized P&L delta, cumulative realized P&L, and `position_reduced` or `position_closed`. The existing journal engine records the normalized lifecycle and originating evaluation linkage. No parallel P&L formula was introduced.

## Duplicate and atomicity boundary

The fingerprint includes position, quantity, quote timestamp, reference price, and closing side. An identical request cannot apply accounting twice. Position, account, exit, and journal summaries are written as one aggregate document, preventing partial writes within a request.

PostgreSQL row locks serialize account and selected-position mutations, revision predicates reject stale writes, and the account-scoped fingerprint constraint suppresses duplicate exits across instances and retries. Conflicting over-closes fail without a partial execution or realized-P&L mutation.

Completed reductions and closes are consumed automatically by PA.3. Opening fills remain excluded until explicit realized P&L exists. Everything remains paper-only and advisory; no strategy, score, regime, scanner, risk, or live-trading behavior changes.

## PI.3 durable lifecycle

The authoritative PA.4 source is the tenant/account/user/team-scoped PI.3 PostgreSQL account and position projection. Confirmation and fresh-price controls are unchanged. One transaction locks the account and position, validates quantity, claims a unique exit fingerprint, appends the immutable reduction/close, updates account cash and cumulative realized P&L, and revision-updates or closes the position. Failures roll back all changes; retries return the prior result without reapplying accounting. The former `operatorActions` aggregate remains compatibility-only and is not called by PA.4.

PI.4 projects every completed reduction/close into portfolio, journal, PA.3, and PA.5 reads without writing another trade ledger. No PA.4 lifecycle or P&L calculation changed.
