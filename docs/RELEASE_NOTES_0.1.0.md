# AiLover 0.1.0 MVP

## Included

- Windows local-first desktop application with guided first-run setup.
- One persistent companion character with structured identity, personality baseline and speaking style.
- OpenAI-compatible and Ollama chat providers with encrypted local credential storage.
- Streaming chat, cancellation, timeout handling, retryable failures and restart recovery.
- Evidence-backed memory for preferences, plans and important interactions.
- Bounded emotion, relationship and personality evolution with traceable source messages.
- Natural-language relationship summary without exposing internal scores.
- Versioned local portrait imports and independent image-capability detection.
- Validated backup and restore with checksums, rollback and credential exclusion.
- Privacy-safe diagnostics and explicit permanent local-data deletion.

## Privacy

- Character data, conversations, memory, cognition and imported assets are stored locally.
- Online model requests receive only the selected conversation context, relevant memories and a
  natural-language cognition projection.
- Backups contain private conversation data but exclude model credentials.
- Diagnostic files exclude conversation bodies, memory bodies, credentials and local paths.

## Known Limitations

- The MVP supports one active character and one current conversation timeline.
- Image generation and automatic reference-image analysis are capability interfaces only; portrait
  import is the reliable default path.
- There is no automatic updater or production code-signing certificate yet.
- The installer currently uses the default Electron application icon.
- Windows 10 installation is exercised on the development host. Windows 11 remains a release-candidate
  compatibility check on a separate clean machine or virtual machine.
- Backups use JSON/base64 and are limited to 512 MB of decoded data and 20 MB per asset.
- Deleting application data does not delete backup files previously exported elsewhere by the user.
