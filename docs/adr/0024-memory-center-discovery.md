# ADR 0024: Memory Center Discovery

## Status

Accepted

## Decision

Memory Center queries return active and expired records while excluding superseded records. The renderer provides local keyword search, type and status filters, plus recent or importance sorting over the bounded result set. Expired memories remain visible but cannot be edited or deleted again.

## Rationale

Users need to find and understand accumulated memories, and soft deletion is only recoverable when expired records remain visible. Local controls avoid extra database round trips for the current bounded list.
