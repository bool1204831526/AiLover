# ADR 0023: Personality Evidence View

## Status

Accepted

## Decision

The relationship page may display evidence counts, the latest human-readable reason and its date for each affected personality trait. The main process scopes evidence queries to the active character, summarizes at most 100 recent records and returns validated display data. Raw personality state values are not exposed.

## Rationale

Users should understand why a personality tendency developed without being asked to interpret internal floating-point state or unrestricted database records.
