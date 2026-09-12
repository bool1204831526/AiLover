# ADR 0028: Structured Memory Transport

## Status

Accepted

## Decision

Structured memory extraction uses a separate non-streaming request with a short timeout. OpenAI-compatible providers receive JSON-object response guidance; Ollama receives its native JSON format hint. Transport errors are retryable or isolated and never replace the normal streaming chat request. Returned JSON remains untrusted until it passes the memory package validation boundary.

## Rationale

Extraction is secondary work and must not delay or fail an otherwise successful conversation. Keeping transport separate also allows provider-specific response envelopes to be normalized in one place before local evidence validation.
