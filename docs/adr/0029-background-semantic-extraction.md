# ADR 0029: Background Semantic Extraction

## Status

Accepted

## Decision

After a chat reply completes successfully, likely durable user information may schedule a separate structured extraction task. The active chat is released before this task starts. Ordinary short chat, questions and uncertain statements are skipped, input is bounded to 4,000 characters and the request times out after eight seconds. Validated candidates enter memory through the same conflict, reinforcement and evidence persistence path as deterministic candidates.

## Rationale

Memory enrichment must not delay the visible reply or prevent the user from sending another message. Signal gating controls model cost, while local extraction remains available regardless of provider failure and the shared persistence path preserves existing memory invariants.
