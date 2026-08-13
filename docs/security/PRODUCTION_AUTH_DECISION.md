# AUTH-D1 Production Authentication Decision Audit

Status: accepted; AUTH.1 foundation implemented

Decision date: 2026-08-11

Decision scope: production identity and session provider only

This document began as the AUTH-D1 audit and is retained as the decision record baseline. The recommendation was accepted for AUTH.1. Atlas remains paper-trading-only and advisory-only.

## Decision summary

Use **Netlify Identity on the existing Atlas Netlify project**, configured invite-only initially, with `@netlify/identity` integrated through Atlas's existing authentication adapter boundary.

Netlify Identity is the smallest production-safe path because Atlas already deploys its SPA and Functions on Netlify. Current Netlify documentation states that Identity remains supported, provides browser session cookies and server-side user verification in Functions, and is available on credit-based plans at no additional charge. Atlas should use Netlify only for identity and session proof; Atlas's existing PostgreSQL-backed users, organization memberships, team memberships, roles, and tenant checks remain the authorization system of record.

This recommendation does not rely on another project's use of Supabase and does not introduce Supabase into Atlas.

## AUTH.1 implementation status

- `@netlify/identity` is installed and used by the root browser authentication boundary.
- Invite callbacks, password activation, sign-in, sign-out, session restoration, loading, unauthenticated, authenticated, and expired-session states are implemented without public signup or OAuth controls.
- The central workspace API client reads the current `nf_jwt` cookie and attaches it as a bearer token; 401 responses return the browser to the sign-in boundary.
- `createNetlifyIdentityAuthAdapter` rejects malformed/expired tokens before network access and verifies otherwise well-formed tokens through the configured Netlify Identity `/user` endpoint.
- Production environment validation requires `ATLAS_AUTH_MODE=netlify-identity` and a site/Identity URL. Local development authentication cannot be selected in production.
- Only explicit safe roles from verified Identity metadata are normalized. Missing roles remain `null` and existing Atlas authorization default-denies them.
- Organization/team/tenant authorization, CSRF behavior, trading logic, market providers, billing, and database schema are unchanged.
- The linked account plan reports Identity included. Enabling Identity, enforcing invite-only site settings, inviting/assigning the first owner, and production smoke evidence remain manual release gates.

## Pre-AUTH.1 audited state

### Existing authentication and session architecture

- `lib/auth/authenticationProvider.js` defines normalized users and sessions plus a swappable provider interface with `authenticate` and `healthCheck` methods.
- The configured implementation is `createLocalDevelopmentAuthAdapter`. It constructs a local user/session from request headers and is explicitly marked `productionSafe: false`.
- `netlify/functions/_shared/authApi.js` extracts a bearer value or `atlas_session` cookie, validates a session object, evaluates Atlas role permissions, and composes organization/team membership checks.
- `lib/auth/identityRepository.js` can persist provider-subject user mappings and hashed Atlas session-token records in generic PostgreSQL.
- Organization and team authorization are separate from identity. They evaluate Atlas memberships, requested organization/team IDs, role permissions, and cross-tenant boundaries.
- The API inventory classifies 242 Functions under authenticated wrappers and 28 under the plain wrapper. Twelve plain endpoints are P0 mutations and eight are P1 sensitive reads.
- `src/api/workspaceApiClient.js` sends neither a bearer token nor an authenticated-session integration. It sends a fixed `x-csrf-token` string for mutations.
- No sign-in, sign-out, registration, recovery, callback, auth context, protected-route, or session-expiration UI exists.
- No production identity SDK or provider-specific configuration exists in `package.json` or `.env.example`.

### Production-safe pieces

- Provider abstraction and normalized user/session contracts.
- Default-deny role evaluation when role context is missing.
- Organization/team membership and cross-tenant authorization logic when supplied with a verified identity and durable membership data.
- Hashed-token persistence capability; raw access tokens are not intentionally stored.
- Shared method, request-size, JSON, unsafe-key, rate-limit, error, and observability controls.
- Paper-only and no-broker-execution invariants.

### Development-only pieces

- The local-development adapter.
- `x-atlas-dev-role`, `x-atlas-dev-subject`, and arbitrary bearer values used to construct development identity.
- The default development role of owner.
- Test setup that injects `Bearer test-session` into browser API calls.

### Incomplete pieces

- Production credential verification and issuer/audience/signature validation.
- Browser sign-in, logout, recovery, session refresh, and expiration handling.
- Identity-to-Atlas-user provisioning and membership assignment policy.
- Provider-aware session revocation semantics.
- Production origin configuration and meaningful CSRF verification.
- Protection and tenant scoping for the 28 plain-wrapper Functions.

### Unsafe for production

- Treating any supplied bearer string as a valid local owner session.
- Enabling the local adapter in a production environment.
- Treating the fixed CSRF header value as proof that the request originated from the authenticated Atlas browser.
- Treating Atlas's local session table as able to revoke an external provider token unless provider revocation is also performed.
- Exposing paper-order/state mutations and sensitive paper/portfolio reads through plain wrappers.

## Pre-AUTH.1 production authentication gap

Atlas has authorization models but no production authentication authority. The server cannot establish that a request came from a real, currently authenticated user, and the browser cannot create or transport a production session. The local adapter fills contract shapes for tests and development but performs no cryptographic or provider-side credential validation.

This gap cannot be closed by configuration alone. Atlas needs a managed identity/session authority or must assume responsibility for passwords, recovery, verification, token issuance, rotation, revocation, abuse controls, and security maintenance.

## Options evaluated

### A. Harden the existing Atlas architecture into custom authentication

Technically possible, but not recommended.

Atlas would need to add credential enrollment, password hashing with a maintained password-hashing implementation, account confirmation, password reset/recovery, secure email delivery, login throttling, breached-password policy, session-token generation and rotation, secure cookie issuance, logout/revocation, CSRF defenses, audit and incident procedures, secret rotation, and continuous vulnerability maintenance. The current schema stores identities and hashed session tokens but no password credential or recovery-token model, so a production password system would require schema changes or another credential store.

Required secrets and services would include a database connection, server-side session/credential secrets where applicable, and an email delivery account with credentials for confirmation and recovery. Atlas would own password storage, account recovery, token security, session invalidation, credential incident response, abuse prevention, and ongoing standards updates.

This avoids identity-vendor lock-in but creates disproportionate custom-auth risk and operational cost for a portfolio-scale application. Existing abstractions should be retained, not mistaken for a complete credential system.

### B. Supabase Auth free tier

Viable, production-oriented, and safer than custom authentication, but not the smallest Atlas change.

Supabase Auth provides browser authentication, access/refresh token sessions, password and passwordless flows, and signed JWTs. Netlify Functions could verify asymmetric tokens against the project's JWKS or use the Supabase SDK. Atlas organization/team authorization could remain unchanged by mapping the verified Supabase `sub` claim to `atlas_users.provider_subject`.

It would require a new Supabase account or access to one, a new project, a new hosted service, provider URL/publishable configuration, a new client/server integration dependency or maintained JWT-verification library, callback configuration, and an additional operational console. No Atlas database migration is inherently required.

The current Supabase Free plan lists 50,000 monthly active users at $0, but free projects may pause after one week of inactivity. Non-pausing production operation starts with the Pro plan, currently from $25 per month. Some enhanced session controls are also paid-plan features. These constraints make the free tier less predictable for an always-available production demonstration.

Official references:

- [Supabase Auth](https://supabase.com/docs/guides/auth)
- [Supabase user sessions](https://supabase.com/docs/guides/auth/sessions)
- [Supabase JWT verification](https://supabase.com/docs/guides/auth/jwts)
- [Supabase pricing](https://supabase.com/pricing)

### C. Netlify Identity

Viable and recommended.

Netlify Identity is currently a supported Netlify authentication option. It provides email/password and supported social login, confirmation and recovery flows, invite-only registration, JWT-backed sessions, browser cookies, logout, server-side user verification in Netlify Functions, and managed role metadata. Current documentation recommends `@netlify/identity` for new integrations.

For Atlas, it uses the existing hosting account, domain, HTTPS boundary, and Function runtime. The `nf_jwt` cookie is sent automatically to the same Netlify project. Atlas can implement a production provider adapter that converts a verified Netlify user into the existing normalized identity contract, then continue through current Atlas role and organization/team authorization.

Identity should be configured invite-only for AUTH.1. Atlas roles may be mapped from provider-managed app metadata only as a coarse account role; organization/team membership must remain in Atlas PostgreSQL so tenant authorization does not become provider-specific. Provider role changes take effect on token refresh, so sensitive membership revocation should continue to query Atlas membership state.

Current Netlify documentation says Identity is available on all credit-based plans at no additional charge, with unlimited active and invite-only users. Free/Personal lacks custom outgoing email, custom email templates, and Identity audit logs. The owner must verify the Atlas site is on an eligible current plan before approval. Advanced enterprise authentication requirements such as broad enterprise SSO or richer MFA would require later re-evaluation.

Official references:

- [Netlify Identity overview and availability](https://docs.netlify.com/manage/security/secure-access-to-sites/identity/overview/)
- [Add Identity to a project](https://docs.netlify.com/manage/security/secure-access-to-sites/identity/get-started/)
- [Use Identity in Functions and protect auth endpoints from CSRF](https://docs.netlify.com/manage/security/secure-access-to-sites/identity/use-identity-in-functions/)
- [Netlify JWT role-based access](https://docs.netlify.com/manage/security/secure-access-to-sites/role-based-access-control/)
- [Netlify's February 2026 support continuation](https://www.netlify.com/blog/auth0-extension-identity-changes/)

### D. Identity option present before AUTH.1

No production identity option is already present. The external-provider contract is an interface placeholder, not a provider. PostgreSQL identity and session repositories persist application records but do not authenticate credentials. No existing dependency verifies a managed identity token.

### E. Another free managed provider

Not expanded into a vendor comparison. Auth0, Clerk, and similar providers may be viable, but none is clearly superior under this phase's priorities because each introduces a separate account, hosted service, configuration boundary, integration dependency, and incremental lock-in. Netlify Identity already satisfies the current Atlas scale and deployment requirements with less disruption.

## Concise comparison

| Criterion | Custom Atlas auth | Supabase Auth Free | Netlify Identity |
| --- | --- | --- | --- |
| Production security | Possible only after substantial specialist work | Managed and production-oriented | Managed and production-oriented |
| Implementation complexity | High | Medium | Low-medium |
| Ongoing Atlas maintenance | High | Low-medium | Low |
| Browser sessions | Atlas must build all flows | SDK-managed access/refresh tokens | Managed `nf_jwt`/refresh cookies and SDK flows |
| Server verification | Atlas must design and operate | SDK, provider API, or JWKS | Native Netlify Function integration |
| Netlify Functions fit | Custom integration | Supported via bearer JWT | Native hosting/runtime fit |
| Org/team compatibility | Full control | Preserve Atlas membership checks | Preserve Atlas membership checks |
| Tenant isolation | Atlas-owned | Atlas-owned | Atlas-owned |
| Logout/expiration | Atlas-owned | Managed; advanced lifetime controls may require Pro | Managed logout/token refresh; Atlas still checks membership |
| CSRF | Atlas must build | Bearer transport reduces ambient-cookie risk; auth flow still needs safe callbacks/storage | Cookie flow requires origin/CSRF controls; official helper available |
| Secrets/config | Credential/session secrets plus email credentials | Project URL and publishable key; server secrets only for privileged operations | Site Identity configuration; no JWT secret exposed for standard same-site use |
| Dependency impact | Password/session/email libraries | Supabase SDK or JWT library | `@netlify/identity` |
| Schema migration | Likely required for credentials/recovery | Not required for Atlas | Not required for Atlas |
| Current-scale recurring identity cost | Service may be $0; operational labor and email may not be | $0 within Free quotas; project pausing caveat | $0 additional on eligible credit-based plan |
| Lock-in | Low vendor lock-in, high custom-code lock-in | Medium | Medium, but lowest incremental lock-in for current hosting |
| Future scale | Atlas must operate it | Strong, paid tiers available | Suitable for current scale; advanced enterprise needs may require re-evaluation |

## Cost and account implications

| Option | New account | New hosted service | Paid plan required now | Database migration | Required recurring cost at current Atlas scale |
| --- | --- | --- | --- | --- | --- |
| Custom Atlas auth | Email/provider account likely | Email delivery at minimum | Not necessarily | Likely | No fixed identity fee, but infrastructure and maintenance burden remain |
| Supabase Auth Free | Yes, unless owner already has authorized Supabase access | Yes, new Supabase project | No for Free quotas; Pro needed to avoid free-project pausing | No | $0 on Free within limits; reliable non-pausing plan currently starts at $25/month |
| Netlify Identity | No separate vendor account if the owner can administer the existing Atlas Netlify site | Yes, an Identity service instance on the existing site | No additional plan charge if the site is on an eligible credit-based plan | No | No required additional identity charge at current scale, subject to plan/credit verification |

Custom outgoing Identity email, custom templates, and Identity audit logs are not included on Free/Personal. Standard managed confirmation/recovery email is sufficient for the proposed invite-only AUTH.1 scope; branded email is not required.

## Architecture impact of the recommendation

### Preserved

- React/Vite SPA and Netlify Functions deployment.
- `createAuthenticatedApiHandler` as the central authentication/authorization composition point.
- Normalized Atlas user/session contracts.
- `atlas_users` provider-subject mapping.
- Atlas role evaluation and organization/team membership repositories.
- Generic PostgreSQL through `pg`; no Supabase adoption and no schema change.
- Paper trading, no brokerage execution, AI advisory, risk, and provider boundaries.

### Changed by AUTH.1

- Add a Netlify Identity provider adapter behind the existing interface.
- Add browser sign-in, callback, session state, logout, and expiry UI.
- Configure same-origin cookie transport and production origin/CSRF validation.
- Map verified Netlify user IDs to Atlas users without automatically granting owner access.
- Make provider session state authoritative; avoid claiming Atlas-local revocation invalidates a still-valid provider JWT.

## Security tradeoffs

Netlify Identity is safer than custom Atlas credential infrastructure because Netlify owns password hashing, confirmation, recovery, JWT issuance, signing-key operation, refresh behavior, and authentication abuse controls. Atlas retains only application authorization and tenant isolation, which it already models.

The principal tradeoff is platform lock-in to Netlify's Identity/session format. The existing adapter boundary limits that lock-in: only the provider adapter and browser session layer should be provider-specific. Atlas users and memberships remain provider-neutral PostgreSQL records.

Cookie-capable authentication makes robust CSRF handling mandatory even though the normal API path sends a bearer header. AUTH.2 replaces presence-only handling with a short-lived, random HMAC token bound to the verified bearer/user/session, environment-aware exact deployment origins, automatic mutation transport, one bounded refresh/retry, and logout/user-switch clearing. XSS remains able to act as the signed-in user, so the implementation retains safe rendering and avoids token exposure. See [Atlas API Authentication and CSRF Protection](CSRF_AND_API_PROTECTION.md).

Netlify role claims must not become the sole tenant-authorization source. Role changes are not reflected until token refresh, while Atlas organization/team membership checks can evaluate current durable state on each request.

## Recommendation rationale

Netlify Identity best satisfies the ordered decision criteria:

1. It is a managed production authentication system, safer than Atlas-owned passwords and recovery.
2. It requires no additional identity subscription at the current scale on an eligible existing plan.
3. It fits the deployed same-origin Netlify SPA/Functions architecture.
4. It supplies a stable user identity that the existing Atlas organization/team authorization can consume.
5. It minimizes new operational consoles, secrets, token-verification code, and maintenance.
6. The Atlas provider interface preserves a future migration path if enterprise requirements outgrow it.

Supabase Auth is the fallback managed option if the owner rejects Netlify platform lock-in or the current Atlas Netlify plan is ineligible. It is not the first choice because it adds a separate service boundary and the Free plan's inactivity pause weakens the no-cost always-available production story.

## Accepted ADR entry

See [ADR-0016: Netlify Identity Production Authentication](../adr/0016-netlify-identity-production-authentication.md).

## Historical AUTH.1 implementation plan

AUTH.1 should be one bounded **Netlify Identity session foundation** phase. It must not also migrate all 28 plain endpoints.

### In scope

1. Approve and create ADR-0016 from the draft above before code changes.
2. Owner enables Netlify Identity on a non-production deploy context or approved Atlas site, selects invite-only registration, and records plan eligibility without committing secrets.
3. Add the reviewed `@netlify/identity` dependency and document its owner, security purpose, license, and lock-in.
4. Implement `createNetlifyIdentityAuthAdapter` behind the existing provider contract; production must fail closed if Identity verification is unavailable or misconfigured.
5. Normalize verified provider ID, email, display name, and coarse role into Atlas identity. Default new identities to no privileged Atlas membership; never default production users to owner.
6. Upsert the provider-subject mapping in `atlas_users` without storing raw provider access or refresh tokens.
7. Add a minimal accessible sign-in/callback/session-expired/logout experience and an application auth context. Use same-origin cookie transport and explicitly include credentials where required.
8. Make `createAuthenticatedApiHandler` consume verified Netlify identity while retaining current Atlas role, organization, and team authorization.
9. Replace hard-coded localhost-only origin assumptions with explicit environment-aware allowed origins. Apply Netlify's request-origin verification to login/logout and an approved, server-verifiable CSRF mechanism to authenticated Atlas mutations.
10. Reconcile session endpoints: provider session/logout is authoritative; Atlas session records may be audit metadata but must not claim independent provider-token revocation.
11. Add focused tests for missing/invalid/expired sessions, login/logout, role normalization, no-owner default, cross-organization/team denial, CSRF/origin rejection, provider outage fail-closed behavior, and absence of raw tokens in logs/persistence.
12. Validate in a deploy preview with invited test identities before any production activation.

### Explicit AUTH.1 exclusions

- Migrating the 12 P0 and eight P1 plain endpoints; schedule this immediately as AUTH.2 after the foundation is accepted.
- Open public signup, social OAuth, custom email branding, MFA, enterprise SSO, billing changes, or paid-plan activation.
- Database schema changes, Supabase adoption, provider/broker/trading/AI changes, or production deployment.
- Replacing Atlas organization/team authorization with provider roles.

### AUTH.1 acceptance gate

AUTH.1 is complete only when a deploy-preview browser can sign in and out, protected Functions reject missing/invalid/expired identity, verified users map to non-privileged Atlas identities, tenant authorization remains enforced, mutation requests fail closed on origin/CSRF violations, provider tokens are not persisted or logged, and the full established validation cycle passes. Atlas must still be reported as not production-ready until AUTH.2 protects the P0/P1 plain endpoints.

## Historical non-goals of the AUTH-D1 audit

- Implementing or enabling Netlify Identity.
- Selecting initial users or granting owner/admin membership.
- Adding a dependency or environment variable.
- Changing API wrappers, browser behavior, session behavior, or CSRF behavior.
- Migrating a database or altering generic PostgreSQL persistence.
- Changing trading, risk, brokerage, AI, market-data providers, billing, deployment, or release behavior.
- Finalizing an ADR or authorizing production rollout.
