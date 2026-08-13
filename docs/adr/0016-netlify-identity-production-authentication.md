# ADR-0016: Netlify Identity Production Authentication

Status: Accepted

Date: 2026-08-11

## Context

Atlas requires a production identity and session authority for its React SPA and Netlify Functions. The previous local adapter accepted arbitrary bearer text and exists only to support deterministic development and tests. Atlas already owns authorization: role evaluation, PostgreSQL user mappings, organization memberships, team memberships, and cross-tenant checks must remain independent of the identity vendor.

The linked `atlas-market` Netlify site is on a credit-based Personal plan whose capability response includes Identity. No plan upgrade, paid add-on, new vendor account, custom email service, or schema migration is required for this foundation.

## Decision

Use Netlify Identity and `@netlify/identity` for invite-only email/password authentication and managed access/refresh sessions.

- The browser processes callbacks at the application root, accepts invitations, signs in/out, restores sessions, and attaches the current `nf_jwt` access token through the central API client.
- Netlify Functions select the Netlify Identity adapter in production. The adapter rejects missing, malformed, expired, arbitrary, provider-rejected, and unavailable-verification sessions.
- Provider verification uses the site Identity `/user` endpoint. Atlas does not implement JWT signature verification, issue tokens, store passwords, or store raw access/refresh tokens.
- Only explicit safe roles in verified provider metadata enter the Atlas role evaluator. A verified identity with no assigned role receives no fabricated authority and is denied by existing default-deny authorization.
- Atlas organization/team membership and tenant boundaries remain authoritative and unchanged.
- Public signup and OAuth controls are not exposed. The site must be configured for invite-only registration before release.
- The local adapter remains available only under explicit development/test selection and cannot be selected when `NODE_ENV=production`.
- AUTH.2 issues short-lived, random, HMAC-signed CSRF tokens bound to the independently verified bearer/user/session. The central browser API client attaches them only to mutations, refreshes/retries once on expiry, and clears them on logout or user change.

## Consequences

The implementation adds one runtime dependency and a provider-specific browser/session adapter while preserving Atlas domain, trading, provider, billing, and database boundaries. Deployment requires enabling Identity, disabling public signup and OAuth providers, inviting the first owner, assigning an explicit Atlas-safe role, and configuring production environment variables. Custom Identity email templates, outgoing email, and Identity audit logs are not available on the current plan and are not required for this phase.

Netlify platform coupling is accepted at the authentication edge. The existing adapter boundary, normalized Atlas identity, and independent tenant authorization preserve a future migration path.

## Rejected alternatives

- Custom Atlas password, recovery, and JWT infrastructure: disproportionate security and maintenance ownership.
- Supabase Auth: production-capable, but introduces another service/account boundary and a free-project availability caveat.
- Other managed providers: no demonstrated reduction in cost or disruption for the current same-origin Netlify architecture.

## Follow-up

AUTH.2 source hardening is complete: former P0/P1 plain routes are protected, only documented public reads remain plain, and deployment origins are environment-aware. Production release evidence must still prove invite-only site configuration, explicit owner role assignment, login/recovery/logout/refresh, CSRF establishment and denial, tenant/role denial, and authenticated critical journeys.
