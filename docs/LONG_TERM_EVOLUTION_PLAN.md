# Long-term personality and memory evolution plan

This plan incrementally extends the existing local-first architecture. Existing memory scoring,
conflict handling, decay, cognition bounds, evidence tracking and SQLite storage remain authoritative.

## Invariants

- Models may propose structured candidates, but local validation decides persistent memory and state.
- Every durable memory or personality change remains traceable to messages or stored experiences.
- Personality changes are gradual, bounded against the immutable baseline and evidence-backed.
- Context has hard limits; raw internal scores are never exposed to the chat model.
- Migrations are forward-only, repeatable and preserve existing user data.

## Delivery order

1. Personality Projection: completed; traits become scenario-aware behavior guidance and response strategy.
2. Episodic Memory: completed; detect, persist and recall significant shared experiences.
3. Semantic Extraction: in progress; deterministic implicit-preference candidates now use lower confidence, with validated structured model candidates still planned.
4. Memory Consolidation: in progress; repeated compatible episodes now produce traceable local insights.
5. Self Model: in progress; bounded local facts, beliefs, values and change projections now guide replies.
6. Personality Evidence: completed; evidence can be grouped and inspected with recent source explanations.
7. Relationship Timeline: in progress; important Episode milestones now have a chronological projection.
8. Emotional Association: completed; relevant past experiences now provide a small bounded emotional echo.
9. Future Intention: in progress; active plans produce limited, expiry-aware intentions with local return/keyword trigger and expiry transitions.
10. Memory Center: let users inspect, correct and delete memories with dependency-safe handling.

Each phase must pass type checking, unit and integration tests before the next dependent phase begins.
