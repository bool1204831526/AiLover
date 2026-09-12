# ADR 0014: Explainable Personality Evidence

## Status

Accepted

## Decision

Personality evidence is summarized locally by trait with positive and negative counts and up to five most recent source records. Filtering by a single trait is supported. The summary preserves message identifiers and reasons for future inspection surfaces.

## Rationale

Trait evolution must remain auditable without exposing internal numeric personality values to the response model. This pure projection is compatible with the existing evidence table and can be connected to a user-facing Memory Center later.
