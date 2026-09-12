# ADR 0017: Persisted Future Intention Chat Loop

## Status

Accepted

## Decision

Active plan memories create at most one persisted intention per source memory. Pending intentions are evaluated when a later user message arrives. Triggered descriptions are added as cautious response guidance, never as unsolicited notifications, and become completed only after a successful assistant reply. Expired records are updated before evaluation.

## Rationale

This preserves continuity across restarts while keeping user messages in control of when the companion follows up. Intention storage failures remain isolated from the primary chat path.
