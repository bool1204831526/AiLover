# ADR 0021: Persistent Self Model

## Status

Accepted

## Decision

Self knowledge is stored as categorized facts, beliefs, values and changes. Every entry has a confidence, monotonically increasing character-local version, source message, derivation reason and lifecycle state. Exact category-and-statement duplicates are ignored. Chat persists current projections and recalls at most four recent active entries, falling back to the live projection if storage is unavailable.

## Rationale

A persistent, evidence-linked self model gives the character continuity without allowing unbounded context growth or turning transient emotions into permanent identity.
