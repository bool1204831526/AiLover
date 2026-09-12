# ADR 0008: Validated semantic extraction

- Status: Accepted
- Date: 2026-09-12

## Context

The first memory extractor intentionally favors explicit statements, but users often express stable
preferences indirectly. A second model call for every message would add latency and could make memory
capture recursively dependent on model availability.

## Decision

1. Extend the local extractor with a small, deterministic implicit-preference pattern set.
2. Mark implicit candidates with lower confidence and importance than explicit claims; they still pass
   the existing duplicate, conflict and recall rules.
3. Keep model-assisted structured extraction as a future opt-in channel. It must return validated JSON
   candidates and never write directly to persistence.

## Consequences

- Common implicit preference phrasing gains useful coverage without affecting the reliable chat path.
- The detector remains intentionally narrow; unsupported language is ignored rather than guessed.
- Future semantic candidates can reuse the same local validator and evidence boundary.
