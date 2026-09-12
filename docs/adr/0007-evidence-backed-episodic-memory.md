# ADR 0007: Evidence-backed episodic memory

- Status: Accepted
- Date: 2026-09-12

## Context

Fact and preference memory cannot represent the history shared by a user and character. Storing every
chat turn as an episode would create noise, while model-authored summaries without source references
could turn invented details into durable experience.

## Decision

1. Store episodes separately from ordinary memory while preserving the existing memory system.
2. Deterministic rules create an episode only when importance reaches 0.65. Initial event categories
   cover first events, shared achievements, strong emotion, conflict, repair, disclosure and important
   relationship expression.
3. Every episode links to its user source message and, after a successful response, the assistant
   source message. Related ordinary memory IDs are retained for later consolidation.
4. Exact duplicate event fingerprints reinforce the existing episode instead of creating another.
5. Retrieval combines FTS trigram matching, explicit recollection cues, importance, emotion,
   relationship relevance, confidence, recency and reinforcement. At most three episodes enter context.
6. Recall is audited against the query message. The model receives concise evidence-labelled event
   summaries and cannot create or modify stored episodes directly.

## Consequences

- AiLover can refer to real shared history without treating every message as a lasting experience.
- The initial deterministic detector favors precision and has limited linguistic coverage; semantic
  model candidates may be added later behind local validation.
- Separate episode storage supports future consolidation, relationship milestones and Self Model work.
