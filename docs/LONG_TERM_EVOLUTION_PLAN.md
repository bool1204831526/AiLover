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
3. Semantic Extraction: in progress; deterministic implicit-preference candidates use lower confidence, a strict evidence-backed validation boundary guards structured model proposals, and non-streaming OpenAI-compatible/Ollama JSON transport is available for the next chat-lifecycle integration.
4. Memory Consolidation: completed; repeated compatible episodes automatically form, persist, reinforce and cautiously guide later replies.
5. Self Model: completed; categorized, evidence-linked and versioned self knowledge persists across restarts and guides replies.
6. Personality Evidence: completed; evidence can be grouped and inspected with recent source explanations.
7. Relationship Timeline: completed; important Episode milestones are available through validated IPC and displayed chronologically in the relationship view.
8. Emotional Association: completed; relevant past experiences now provide a small bounded emotional echo.
9. Future Intention: completed; plans persist across restarts, trigger on a later conversation, expire locally and complete after a successful reply.
10. Memory Center: in progress; users can inspect, search, filter, sort, correct and soft-delete memories with character-scoped handling.

Each phase must pass type checking, unit and integration tests before the next dependent phase begins.
