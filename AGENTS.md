# Atlas Project Rules

## Scope
**ONLY** `F:\atlas-market`.

## Explicit Denials
- **NEVER** read, write, execute against, or modify `F:\personal_ai_os`.
- **NEVER** access unrelated repositories.

## Invariants (Preserve)
- PAPER ONLY
- Live execution disabled
- Human Save Review
- Manual PA.1
- Manual forward observation
- Human execution/exit gates
- Org/user isolation
- Atomic uniqueness/claim semantics
- Stale recovery / expiry
- Provider pacing
- Existing strategy/TQ/risk rules
- Automated Governed Review discovery ONLY: BREAKOUT.1, RANGE.1, VOL.1
- EDGE.2 excluded / manual-only

## Behavioral Rules
- One mission at a time.
- No destructive Git or filesystem operations.
- No broad dependency installs.
- No unrelated cleanup or refactors.
- Production behavior is authoritative — tests, build, and deploy alone are not production acceptance.
- Never expose raw claim tokens or secrets.
- PAIO is out of scope.

## Drift Circuit Breaker
Before every action, ask:
> Does this action directly narrow, repair, validate, or prove the current mission?

If **no**, skip it.  
If **two consecutive actions** do not narrow, repair, validate, or prove the mission, stop that branch and return to the current boundary.

## Capability Blockers
If required proof depends on unavailable browser, auth, or tool capability — **stop with the exact blocker** rather than inventing substitutes.

## References
- `.kilo/agents/atlas-diagnose.md`
- `.kilo/agents/atlas-repair.md`
- `.kilo/context/atlas-production.md`
- `.kilo/templates/mission.md`
- `.kilo/templates/diagnose-to-repair-handoff.md`