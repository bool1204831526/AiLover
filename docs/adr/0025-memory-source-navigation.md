# ADR 0025: Memory Source Navigation

## Status

Accepted

## Decision

Memory Center entries may expose their earliest source message ID, conversation ID, date and an excerpt capped at 180 characters. The repository requires both active character ID and memory ID. Selecting the source opens the existing bounded conversation-context view, where the user can return to the latest messages.

## Rationale

Corrections are more trustworthy when users can inspect the original statement in context. Character scoping and excerpt limits prevent the Memory Center API from becoming an unrestricted conversation export.
