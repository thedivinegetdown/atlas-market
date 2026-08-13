# PI.4 durable paper workflow integration

Status: implemented and verified against the approved local non-production PostgreSQL database on 2026-08-13.

## Canonical production path

The production paper path is Reviewed Opportunity → PA.1 evaluation → PA.2 intent and transactional entry → PI.3 account/execution/position source → PA.4 transactional reduction or close → PA.3/PA.5 deterministic analytics. PI.4 completes the read and configuration edges around that source.

- Portfolio/accounting reads are derived from the canonical paper account, open-position projection, and immutable executions. They do not use the legacy process-memory order account.
- Journal trade rows are a deterministic view of immutable executions. Atlas does not persist a second trade ledger.
- PA.3 and PA.5 continue to recompute from realized reduction/close executions with unchanged formulas.
- Daily Briefing receives the durable portfolio projection and durable alert definitions while retaining its existing single market-overview request. Briefings remain derived and are not persisted.
- Scanner and alert definitions use the existing PostgreSQL tables with organization, team, account, and user predicates. Scanner matches and alert evaluations remain derived.

## Failure and isolation contract

Canonical PI.4 reads and definition mutations require connected PostgreSQL. Production never falls back to process memory. Stable public errors omit PostgreSQL details. Authenticated Functions establish organization/user scope, mutations retain the existing CSRF boundary, and repository SQL also predicates organization, team, account, and user. Cross-tenant identifier reuse cannot update an existing definition.

The legacy plain-wrapper portfolio, journal, scanner, alert, and `submit-paper-order` Functions remain compatibility-only and are not called by the browser's canonical paper workflow. Their retirement and AUTH.2 control work remain separate approved phases.

## State classification

| State | Classification |
| --- | --- |
| PI.3 account, positions, executions | Durable canonical source |
| Portfolio summary, journal trade rows, PA.3, PA.5 | Deterministic projections |
| Scanner/alert definitions and enabled lifecycle | Durable configuration |
| Scanner matches, alert evaluations, Daily Briefing | Derived ephemeral evidence |
| Legacy order/account/portfolio/journal arrays | Compatibility-only process memory |
| Provider cache, in-flight deduplication, request budgets | Operational process memory; never accounting evidence |

## PostgreSQL verification

Migration `202608130070_pi4_durable_workspace_definitions` was applied and tracked in `atlas_schema_migrations` on the approved local disposable database. Both composite scope indexes were verified. Synthetic scanner and alert definitions survived repository re-instantiation, cross-organization reads were denied, and the uniquely identified records were removed afterward. No production system was contacted and no credential was printed.

## Remaining owner actions

Production migration rollout, database capacity, backups/restores, retention, and authenticated deployed smoke/E2E remain unverified. The inherited Windows `DATABASE_URL` was stale during verification; the ignored local `.env.local` value succeeded. Production configuration must be validated independently without copying local credentials.
