# ADR 0002: Use a validated IPC boundary

- Status: Accepted
- Date: 2026-09-10

## Context

The renderer displays untrusted model output and will eventually accept user-selected files. Giving it direct Node or database access would make a UI compromise much more damaging.

## Decision

Keep context isolation and sandboxing enabled, disable Node integration, and expose a minimal use-case API through preload. Validate all IPC payloads with shared Zod schemas in both the calling and receiving layers.

## Consequences

- New renderer capabilities require an explicit contract and main-process handler.
- Provider credentials, storage paths and future tool execution remain outside the renderer.
- Contract changes are visible and independently testable.
