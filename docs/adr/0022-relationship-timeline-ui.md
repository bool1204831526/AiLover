# ADR 0022: Relationship Timeline UI

## Status

Accepted

## Decision

The relationship page requests a validated chronological milestone projection from the main process. Only active, high-relationship-relevance Episodes are eligible, the result is deduplicated and capped at twelve entries, and no raw Episode internals are exposed to the renderer.

## Rationale

Users need to inspect relationship continuity without browsing internal scores or every ordinary conversation. A narrow projection keeps this surface understandable and bounded.
