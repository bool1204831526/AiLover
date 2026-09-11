# ADR 0005: Validated local backups

## Status

Accepted

## Context

AiLover stores identity, conversations, memory, cognition state and visual assets locally. A usable
MVP needs portable recovery without copying a live SQLite file, exposing model credentials or
allowing a malformed archive to write outside the application data directory.

## Decision

- Backups use a versioned `ailover-backup` JSON envelope containing a consistent SQLite snapshot,
  local assets, sizes and SHA-256 checksums.
- The snapshot always clears encrypted model credentials before serialization.
- Restore rejects unknown structure, invalid checksums, duplicate or unsafe paths, excessive sizes,
  missing referenced assets, corrupt SQLite data and schema versions newer than the running app.
- Restore extracts and validates into a temporary directory before asking for destructive
  confirmation.
- The current database and asset directory are retained as rollback material until replacement
  succeeds. Success and post-close failure both restart the application to obtain fresh database
  connections.

## Consequences

- Backup files contain private conversation content and must be protected by the user.
- JSON/base64 is simple and auditable but increases file size. The format has explicit limits and
  can move to a streaming archive in a later compatible version.
- Model credentials must be re-entered after restore.
