# ADR 0013: Bounded Emotional Association

## Status

Accepted

## Decision

Relevant episodic experiences may nudge current valence, arousal, security and affection through a local pure function. The projection accepts at most three associations, clamps every input and output to `[0, 1]`, and caps each aggregate delta. Positive and negative emotional cues are translated into small, interpretable changes; relationship-relevant experiences may also affect security and affection.

## Rationale

This gives continuity without allowing a single recalled event to dominate the current state. Persistence and model-facing context remain unchanged until a later integration phase can provide durable provenance and user controls.
