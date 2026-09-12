# ADR 0026: Memory Deletion Undo

## Status

Accepted

## Decision

Schema 15 records user-initiated soft deletions in a separate audit table. Memory Center offers restore only when that audit record exists, ownership matches the active character and the memory's original expiry has not passed. Restore removes the audit marker, reactivates the memory and assigns a conservative recall strength.

## Rationale

An expired plan must not become current merely because it shares the same state as a deleted memory. Separate deletion provenance makes undo safe, explainable and character-scoped.
