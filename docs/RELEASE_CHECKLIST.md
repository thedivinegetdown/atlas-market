# Release Checklist

Use this checklist before merging or deploying Atlas Market changes.

- [ ] Tests passed with `npm test` or `npm run test:ci`.
- [ ] Production build passed with `npm run build`.
- [ ] Release candidate branch verified as `part-10-trading-workspace` when preparing this RC.
- [ ] Environment variables verified against `.env.example`.
- [ ] Database migration or schema compatibility verified.
- [ ] Paper trading mode verified as the default and active trading mode.
- [ ] Broker adapter verified as paper-only with `liveOrders: false`.
- [ ] Market data and broker adapters verified in mock mode for the release candidate.
- [ ] Atlas AI provider descriptors, server-side credentials, routing/fallback bounds, and deterministic response evaluation verified without exposing raw provider traffic or secrets.
- [ ] Atlas AI streaming, cancellation, bounded memory, usage budgets, and incomplete-stream persistence protection verified.
- [ ] Atlas opportunity analysis input validation, stale-data warnings, safe persistence, tenant/account/user isolation, and no-trade safety verified.
- [ ] Atlas opportunity ranking, explainability, review-state authorization, tenant-safe history filters, stale/expired indicators, and no-execution UI boundaries verified.
- [ ] Atlas portfolio intelligence deterministic health scoring, AI insight degradation, snapshot history, stale/missing data warnings, and no-execution UI boundaries verified.
- [ ] Atlas performance budget verified with `npm run build` and `npm run performance:check`; heavy AI, opportunity, portfolio, and release panels remain dynamically imported with safe loading/error states.
- [ ] `dist` output remains uncommitted and Vite chunk-size warning status is reviewed against current bundle metrics.
- [ ] API health endpoint verified.
- [ ] No secrets, tokens, database URLs, or private credentials committed.
- [ ] Changelog or release notes updated.
- [ ] Security guardrails verified for API mutations.
- [ ] Observability checks reviewed for degraded services.
- [ ] Asset profile compatibility considered for affected trading workflows.
- [ ] `system.releaseReadiness.evaluated` reviewed with no blockers.
- [ ] `system.releaseCandidate.stabilized` reviewed with no release blockers.
- [ ] Event lifecycle reviewed from adapter checks through stabilization.
- [ ] Known limitations reviewed before release approval.
