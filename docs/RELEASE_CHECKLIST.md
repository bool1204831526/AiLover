# MVP Release Checklist

Run the complete local release gate with `pnpm release:verify`.

## Automated Gates

- [x] TypeScript strict typecheck
- [x] ESLint
- [x] Unit and integration test suite
- [x] Production renderer, preload and main-process build
- [x] Windows NSIS package creation
- [x] Packaged renderer, preload and IPC startup smoke test
- [x] SQLite integrity and migration-version validation
- [x] Backup checksum, unsafe-path, future-version and credential-exclusion tests
- [x] Cross-day conversation, memory and cognition continuity test
- [x] Provider throttling and interrupted-response recovery tests
- [x] Critical SQLite query-plan index assertions
- [x] Packaged startup time under 10-second release budget

## Windows Acceptance

- [x] Windows 10 unpacked build startup
- [x] Windows 10 installer install/start/uninstall exercise
- [x] Windows 10 same-version overwrite upgrade and restart exercise
- [x] Ten-thousand-message persistence profile with a bounded 500-message retained window
- [ ] Windows 11 clean-machine install/start/uninstall exercise
- [ ] Production Authenticode certificate verification
- [ ] Final branded application icon verification

## Release Policy

A public build must not be described as production-signed until the Authenticode check passes. Windows
11 support remains provisional until its clean-machine item is checked. Neither item blocks private MVP
development builds, but both block a broadly distributed release.
