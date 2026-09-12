# ADR 0032: Structured Character Life and Immersion Guard

## Status

Accepted

## Decision

Each character owns a structured life setting containing an origin world, prior life story, worldview,
core motivations, knowledge boundaries and the event that brought them into AiLover. Users may write
all six fields manually or ask the configured chat model to complete them from the character details
already entered. Model output is treated as a proposal and must pass the same strict schema and local
immersion rules as manual input before it can be stored.

The arrival event must connect the character's prior world to AiLover through a summoning, dimensional
rift or equivalent crossing. Stored settings and recalled evidence are injected as identity constraints
for every chat. Explicit model, prompt, role-play and character-card language is prohibited. Replies are
buffered until a deterministic leakage check succeeds, so rejected meta-language is never displayed or
persisted as a completed reply.

Schema 17 stores the life setting separately from the basic character profile. Migration preserves the
existing background as prior-life material and supplies a conservative arrival story for existing users.

## Rationale

A short biography is insufficient to maintain a believable point of view over long conversations.
Separating life history, motivation and knowledge limits gives the model clearer boundaries, while the
local validation layer prevents malformed or explicitly out-of-character content from becoming durable
character identity. Buffering trades token-by-token display for the stronger guarantee that known
meta-language is blocked before reaching the user.

## Limits

Prompting and deterministic phrase detection cannot prove semantic consistency for every possible model
reply. The guard reliably blocks explicit model-awareness leakage; broader contradictions remain subject
to model quality and the evidence available in the character setting and memory system.
