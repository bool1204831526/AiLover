# ADR 0001: Use a modular TypeScript monolith

- Status: Accepted
- Date: 2026-09-10

## Context

AiLover needs strong boundaries between character, memory, cognition, model providers and desktop integrations, but the MVP is a local Windows application maintained as one product.

## Decision

Use a pnpm workspace with an Electron desktop application and framework-independent TypeScript packages. Domain packages cannot depend on Electron, React, storage implementations or model SDKs. Cross-module behavior uses explicit application interfaces and validated contracts.

## Consequences

- One installer and one primary runtime keep deployment and local data access simple.
- Module boundaries can be tested without launching Electron.
- Python or separate processes can be added behind provider interfaces when media or local-model workloads justify them.
- Workspace dependency rules must be reviewed so infrastructure does not leak into the domain layer.
