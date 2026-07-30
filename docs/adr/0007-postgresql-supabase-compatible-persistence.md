# ADR 0007: PostgreSQL Persistence and Supabase-Compatible Boundary

## Status

Accepted for PostgreSQL; Supabase deployment unverified

## Context

Atlas requires durable repositories and migrations while keeping database connectivity and credentials out of the browser. The requested architecture review includes a Supabase boundary, but the repository contains no Supabase SDK or vendor-specific API.

## Decision

Use server-side PostgreSQL through `pg`, `DATABASE_URL`, idempotent migrations, and repository abstractions. A Supabase-hosted PostgreSQL database may sit behind this generic contract, but Atlas does not depend on Supabase client, Auth, Realtime, Storage, or vendor APIs unless a future ADR explicitly adds them.

## Consequences

Persistence is portable across compatible PostgreSQL hosts and testable through repositories. Production host, pooling, backups, recovery, and migration operation are external facts requiring evidence; direct serverless connections may exhaust connection limits.

## Related files or systems

`package.json`, `.env.example`, `lib/db/`, `lib/repositories/`, `netlify/functions/_shared/persistenceApi.js`, `tests/persistence.test.js`, `tests/phase26-persistence-api-foundation.test.js`.
