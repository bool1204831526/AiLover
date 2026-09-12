# ADR 0015: Future Intention Lifecycle

## Status

Accepted

## Decision

Pending intentions transition to `triggered` when the user returns or a configured keyword is present, and to `expired` once their expiry time passes. Existing terminal states are preserved. The transition is a pure local function so callers can persist the returned records in their existing repository transaction.

## Rationale

Plans should guide a future response without creating unsolicited notifications. Explicit lifecycle states make that boundary testable and leave scheduling and UI policy to the application layer.
