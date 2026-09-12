# ADR 0030: Explainable Memory Lifecycle

## Status

Accepted

## Decision

Memory Center includes active, expired and superseded records and projects four user-facing lifecycle states: active, naturally expired, user deleted and superseded. Each entry exposes up to twenty character-scoped source messages and up to twenty linked conflict or replacement records. Reinforcement counts are displayed alongside the evidence history.

## Rationale

Hiding superseded memories or showing only the first source makes corrections difficult to evaluate. Existing source, deletion-audit and link tables already preserve the necessary history, so a bounded read projection can explain why a memory exists and how it changed without altering recall behavior or adding another persistence model.
