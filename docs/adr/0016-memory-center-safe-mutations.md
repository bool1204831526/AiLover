# ADR 0016: Memory Center Safe Mutations

## Status

Accepted

## Decision

Memory Center corrections update only user-editable fields with bounded importance and a refreshed timestamp. Deletion is represented as an expired record with zero recall strength rather than physical removal, preserving provenance and backup consistency.

## Rationale

Users need control over incorrect memories while the system retains enough history to explain and recover changes.
