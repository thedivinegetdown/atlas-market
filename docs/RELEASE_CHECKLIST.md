# Release Checklist

Use this checklist before merging or deploying Atlas Market changes.

- [ ] Tests passed with `npm test` or `npm run test:ci`.
- [ ] Production build passed with `npm run build`.
- [ ] Environment variables verified against `.env.example`.
- [ ] Database migration or schema compatibility verified.
- [ ] Paper trading mode verified as the default and active trading mode.
- [ ] API health endpoint verified.
- [ ] No secrets, tokens, database URLs, or private credentials committed.
- [ ] Changelog or release notes updated.
- [ ] Security guardrails verified for API mutations.
- [ ] Observability checks reviewed for degraded services.
- [ ] Asset profile compatibility considered for affected trading workflows.
