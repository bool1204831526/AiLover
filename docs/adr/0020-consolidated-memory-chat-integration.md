# ADR 0020: Consolidated Memory Chat Integration

## Status

Accepted

## Decision

After a significant Episode is captured, up to 100 recent candidate Episodes are evaluated by the deterministic consolidation rules and resulting insights are persisted or reinforced. Before a reply, at most four active insights are projected as cautious derived context. Consolidation failures are isolated from chat completion.

## Rationale

Consolidation should happen near the evidence-producing event while remaining secondary to the core conversation path. Explicit derived-language guidance prevents an insight from being presented as a directly stated fact.
