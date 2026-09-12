# ADR 0031: Audited Memory Conflict Resolution

## Status

Accepted

## Decision

Memory conflicts can be resolved only between two linked memories owned by the active character. Users may select either memory as current, keep both as context-dependent facts or merge their content and evidence. Each operation runs in one database transaction and schema 16 records the action, chosen memory, merged content and both prior states. A later decision may replace an earlier one without deleting its audit history.

Keeping both assigns the secondary memory a stable context-specific key so recall no longer suppresses it as a direct contradiction. Selecting a single current memory restores the canonical key. Merging retains one active memory, transfers unique evidence and keeps the other as a superseded historical record.

## Rationale

Automatic recency rules cannot reliably decide whether changed statements represent correction, context or genuine coexistence. Explicit user resolution gives the user final authority while transactions, ownership checks and immutable audit rows preserve traceability and prevent cross-character mutation.
