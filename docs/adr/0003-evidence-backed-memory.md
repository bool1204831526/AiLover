# ADR 0003: Evidence-backed local memory

- Status: Accepted
- Date: 2026-09-11

## Context

AiLover needs to remember preferences, plans and shared experiences across sessions without turning
model inference into user facts. Memory must remain useful when no embedding model is configured,
and every recalled fact must be traceable to its source message.

## Decision

1. Stable memory is created only from explicit user statements. Questions, hypotheticals and
   uncertain language are rejected by deterministic validation.
2. Every memory stores one or more immutable source-message records with the exact supporting text.
3. Repeated evidence reinforces an existing memory. Contradictory evidence creates a linked new
   record and marks the older interpretation as superseded; it is not physically deleted.
4. Retrieval combines FTS5 trigram matches, intent-derived type filters, importance, confidence,
   recency, reinforcement frequency, emotional weight and recall strength.
5. Embeddings are optional behind `EmbeddingStore`. Without one, retrieval remains fully functional
   through local FTS5 and structured scoring.
6. Recall writes an audit record containing the query message, selected memory and score. Private
   message bodies are never added to production logs.
7. Decay affects recall strength and expiry state, not source evidence. Relationship memories retain
   a minimum strength; short-term plans expire after their configured window.

## Consequences

- The first extractor intentionally has high precision and limited coverage. Broader model-assisted
  extraction may be added later, but its output must pass the same evidence and confidence checks.
- SQLite remains the only required memory service for the MVP.
- Memory failures degrade to ordinary chat and cannot block or corrupt a response.
