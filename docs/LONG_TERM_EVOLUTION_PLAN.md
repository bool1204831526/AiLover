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
3. Semantic Extraction: combine deterministic rules with validated structured model candidates.
4. Memory Consolidation: derive evidence-backed patterns from multiple compatible episodes.
5. Self Model: add facts, preferences, beliefs, values, experiences and change history about the AI.
6. Personality Evidence: connect experiences and feedback to explainable long-term trait evolution.
7. Relationship Timeline: surface durable relationship milestones from episodes.
8. Emotional Association: let relevant past experiences influence current bounded emotion.
9. Future Intention: create limited, contextual and expiry-aware follow-up intentions.
10. Memory Center: let users inspect, correct and delete memories with dependency-safe handling.

Each phase must pass type checking, unit and integration tests before the next dependent phase begins.
