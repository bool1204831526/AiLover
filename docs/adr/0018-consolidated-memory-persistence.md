# ADR 0018: Consolidated Memory Persistence

## Status

Accepted

## Decision

Consolidated insights are stored separately from direct semantic memories. Each record retains its type, statement, confidence, importance, reinforcement count and lifecycle state. A junction table links every insight to its source Episodes. Equivalent active insights are reinforced and receive only previously unseen source links.

## Rationale

Derived conclusions have different provenance and correction needs from facts stated directly by the user. Separate storage preserves that distinction while supporting durable, evidence-backed consolidation.
