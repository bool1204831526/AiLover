# ADR 0004: Bounded and traceable cognition state

- Status: Accepted
- Date: 2026-09-11

## Context

AiLover needs continuous emotion, relationship and personality behavior without allowing one model
response or one intense interaction to arbitrarily rewrite the character. State changes must remain
understandable, reversible through time decay where appropriate, and traceable to user evidence.

## Decision

1. Deterministic domain rules, not model output, apply state changes. Models receive only a natural
   language projection and a constrained response plan; raw state values are not exposed to them.
2. Emotion changes are capped at 0.15 per interaction and decay toward a neutral baseline over time.
3. Relationship changes are capped at 0.04 per dimension per interaction and do not automatically
   decay like short-lived emotion.
4. Personality starts from the immutable character baseline. A trait may change by at most 0.01
   after three independent, same-direction evidence records, and remains within 0.12 of its baseline.
5. Every state snapshot records its reason, source message, timestamp and rule version. Duplicate
   evidence from the same message is ignored.
6. Important conflict, affection and personal-disclosure interactions create a reflection record.
   Ordinary conversation does not create reflection noise.
7. The relationship UI presents human-readable summaries rather than internal scores or controls.
8. Cognition processing is independent of model availability. A failed model request cannot erase a
   real interaction or prevent its state evidence from being recorded.

## Consequences

- Behavior is intentionally conservative and may feel slower to evolve than an unconstrained prompt.
- Rule versions and historical snapshots make future tuning auditable and migration-friendly.
- Model-assisted signal proposals may be introduced later, but they must pass the same caps, evidence
  rules and persistence boundary before affecting state.
