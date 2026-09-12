# ADR 0027: Structured Memory Validation Boundary

## Status

Accepted

## Decision

Structured extraction models may propose at most six semantic, preference, plan or relationship memories. Every proposal must pass a strict local schema, quote exact text from the user's message and meet local confidence, uncertainty and expiry rules. Stored content and normalized keys are derived locally rather than trusted from model output.

## Rationale

Model output is untrusted and can contain fabricated or overconfident claims. An evidence-first local boundary prevents unsupported statements from becoming durable memory while still allowing model-assisted extraction to be added without weakening the existing deterministic system.
