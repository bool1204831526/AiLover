# ADR 0019: Memory Mutation Ownership

## Status

Accepted

## Decision

Every Memory Center mutation must match both the requested memory ID and the active character ID. The main process resolves the active character and rejects missing or foreign records. Correction changes the derived memory content and importance but never rewrites the immutable source-message evidence.

## Rationale

Renderer input is untrusted even in a local application. Enforcing ownership in SQL prevents cross-character mutation and preserving source evidence keeps corrections auditable.
