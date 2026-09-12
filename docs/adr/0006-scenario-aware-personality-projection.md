# ADR 0006: Scenario-aware personality projection

- Status: Accepted
- Date: 2026-09-12

## Context

AiLover stores a stable personality baseline and a slowly evolving current personality, but raw trait
values do not directly provide useful behavior guidance to the chat model. Passing numeric values to
the model would expose implementation details and encourage mechanical or exaggerated behavior.

## Decision

1. Convert the seven current personality traits into bounded natural-language behavior guidance
   before assembling model context. Raw trait names and numeric values are not sent to the model.
2. Conflict and personal-disclosure scenes take priority over ordinary personality expression.
   Playfulness, energy and initiative cannot override emotional safety or relationship boundaries.
3. Relationship familiarity constrains initiative. A proactive character may extend a topic early in
   a relationship but must avoid intrusive personal questioning.
4. A projection contains at most six concise instructions to preserve the context budget.
5. The existing local cognition engine remains authoritative for trait values and evolution. The
   model receives behavior guidance but cannot write personality state.

## Consequences

- Stored personality now has a direct and testable effect on model behavior without exposing scores.
- Personality expression remains contextual rather than applying every high trait to every response.
- Future Self Model, Episode and emotional-association projections can join the same response-planning
  boundary without changing ownership of core state.
