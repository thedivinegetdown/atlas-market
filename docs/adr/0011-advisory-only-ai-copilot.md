# ADR 0011: Advisory-Only AI Copilot

## Status

Accepted; invariant

## Context

AI can explain research, opportunities, portfolio conditions, and workflows, but provider output is probabilistic and cannot safely hold execution authority.

## Decision

Keep Atlas Copilot advisory and human-reviewed. Route providers server-side, constrain categories/models, build bounded Atlas context, validate/evaluate outputs deterministically, persist only compact safe metadata, and prohibit AI from placing/modifying/cancelling orders or changing broker, risk, deployment, worker, shell, or SQL state.

## Consequences

AI can augment review while deterministic Atlas workflows remain authoritative and available during AI degradation. Output must carry limitations and observed-data/interpretation separation; prompts, raw responses, secrets, private reasoning, and tenant-sensitive content are excluded from public logs and records.

## Related files or systems

`lib/ai/`, `lib/system/aiTradingCopilot*`, `src/core/ai/`, `netlify/functions/atlas-ai-*.js`, `src/components/AtlasCopilotPanel.jsx`, AI phase tests.
