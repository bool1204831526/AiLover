# ADR 0009: Local evidence-backed memory consolidation

- Status: Accepted
- Date: 2026-09-12

## Decision

Repeated active Episodes are grouped by compatible event kind. A group must contain at least two
important Episodes before producing a consolidated insight. The insight stores all source Episode IDs,
uses bounded confidence and importance, and never merges a conflict with a repair event into an
unqualified conclusion. The first implementation is deterministic and local; model-assisted pattern
proposals can be added later behind the same evidence boundary.
