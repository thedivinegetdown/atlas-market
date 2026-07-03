# ADR 0001: Trading OS Architecture

## Status

Accepted

## Context

Atlas Market is evolving from a paper-trading workspace into a production-grade trading operating system. The platform must support current equity paper trading while remaining ready for future real-time data, broker integrations, AI assistants, multi-user accounts, scanners, alerts, backtesting, and plugin-style extensions.

## Decision

Atlas Market uses an asset-agnostic, API-first architecture.

Core decisions:

- Asset behavior is modeled through asset profiles instead of hard-coded equity assumptions.
- Paper trading is the default trading mode.
- React + Vite owns the workspace UI.
- Netlify Functions expose workspace and trading APIs.
- PostgreSQL persistence is accessed server-side through repository and persistence modules.
- Engines remain modular for signals, risk, orders, portfolio, analytics, and journal behavior.
- API clients call server functions instead of importing server-side repositories directly.
- Future brokers, asset classes, data providers, scanners, alerts, assistants, and background jobs should connect through adapters rather than rewriting the workspace contract.

## Consequences

Positive outcomes:

- Existing stock and ETF paper workflows remain stable.
- Forex, crypto, futures, and options can be introduced through profiles and adapters.
- API guardrails, observability, and release gates apply consistently across future endpoints.
- Broker secrets and persistence stay server-side.

Tradeoffs:

- Some infrastructure is intentionally abstract before every future asset or broker is fully implemented.
- API boundaries require more tests than direct in-process UI calls.

## Release Safety

Every release should pass CI, production build, health checks, environment verification, and paper-trading mode verification before deployment.
