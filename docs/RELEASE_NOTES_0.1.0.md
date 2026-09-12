# AiLover 0.1.0 MVP

## Included

- Windows local-first desktop application with guided first-run setup.
- One persistent companion character with structured identity, personality baseline and speaking style.
- OpenAI-compatible and Ollama chat providers with encrypted local credential storage.
- Streaming chat, cancellation, timeout handling, retryable failures and restart recovery.
- Searchable long-term chat history with surrounding context and return-to-latest navigation.
- Evidence-backed memory for preferences, plans and important interactions.
- Evidence-backed episodic memory for significant shared experiences, with bounded recall and audit history.
- Implicit preference extraction for expressions such as “最近越来越离不开拿铁了”, marked with lower confidence.
- Strict local validation for structured memory proposals, including exact source evidence, confidence,
  uncertainty, expiry and candidate-count limits.
- Local consolidation of repeated compatible experiences into source-traceable long-term insights.
- Bounded self-model projections for the companion's current facts, beliefs and values.
- Expiry-aware future-intention candidates derived from active user plans.
- Chronological relationship milestone projection from important shared experiences.
- Bounded emotion, relationship and personality evolution with traceable source messages.
- Scenario-aware personality projection that turns current traits into private, natural-language behavior guidance.
- Natural-language relationship summary without exposing internal scores.
- Versioned local portrait imports and independent image-capability detection.
- Validated backup and restore with checksums, rollback and credential exclusion.
- Privacy-safe diagnostics and explicit permanent local-data deletion.
- Configurable proactive companion notifications with quiet hours and tray-based background lifetime.
- A draggable transparent desktop pet with separate-action WebP/PNG packs and Codex v1/v2 atlas support.
- Event-driven pet reactions for model waiting, generation, completion, failure, positive interactions,
  proactive notifications and left/right window dragging.
- Optional screen-bounded idle roaming, direct pet interaction, double-click opening and a pet context menu.
- Persistent pet position and size, multi-display visibility recovery and an inactivity sleep state.
- Synchronized compact desktop-pet chat with streamed reply bubbles and cross-window message updates.
- Hover and keyboard interaction feedback for the desktop pet without interrupting active chat states.
- A larger multi-line desktop-pet speech bubble with scrolling for longer replies.

## Privacy

- Character data, conversations, memory, cognition and imported assets are stored locally.
- Online model requests receive only the selected conversation context, relevant memories and a
  natural-language cognition projection.
- Backups contain private conversation data but exclude model credentials.
- Diagnostic files exclude conversation bodies, memory bodies, credentials and local paths.

## Known Limitations

- The MVP supports one active character and one current conversation timeline.
- Long conversations retain all records in SQLite and backups. The live view loads the latest 500
  messages, while search can open a focused window around older matching messages.
- Image generation and automatic reference-image analysis are capability interfaces only; portrait
  import is the reliable default path.
- There is no automatic updater or production code-signing certificate yet.
- The installer currently uses the default Electron application icon.
- Windows 10 installation is exercised on the development host. Windows 11 remains a release-candidate
  compatibility check on a separate clean machine or virtual machine.
- Backups use JSON/base64 and are limited to 512 MB of decoded data and 20 MB per asset.
- Deleting application data does not delete backup files previously exported elsewhere by the user.
# Long-term emotional association

- Added a local bounded projection for emotional echoes from relevant episodic experiences.
- Associations are limited to three items and never expose raw internal scores to the model.

# Explainable personality evidence

- Added bounded summaries of trait evidence, including positive/negative counts and recent source messages.
- Added current-character database queries and a relationship-page explanation view without exposing trait scores.

# Future intention lifecycle

- Added deterministic return/keyword triggering and expiry transitions for generated intentions.
- Persisted plan intentions, deduplicated them by source memory and integrated their lifecycle into chat.

# Memory Center corrections

- Added traceable local correction and soft-delete operations for memory records.
- Scoped every memory correction and deletion to the current character and preserved immutable source evidence.
- Added keyword search, type/state filters, sorting and visibility for soft-deleted memories.
- Added character-scoped source excerpts and direct navigation to the source conversation context.
- Added audited undo for user-deleted memories while keeping naturally expired plans non-restorable.

# Consolidated memory persistence

- Added schema 13 storage for long-term insights and their source Episode links.
- Repeated equivalent insights reinforce existing records instead of creating duplicates.
- Integrated automatic post-Episode consolidation and bounded insight recall into the chat lifecycle.

# Persistent self model

- Added schema 14 storage for categorized facts, beliefs, values and changes with source messages and versions.
- Chat now saves new self knowledge and restores the four most recent active entries across restarts.

# Relationship timeline

- Added a chronological relationship view for important evidence-backed Episode milestones.

# Structured memory validation

- Added a strict schema and local trust boundary for model-proposed semantic, preference, plan and relationship memories.
- Rejected fabricated, hypothetical, question-shaped and low-confidence evidence before persistence.
- Kept normalized keys, stored content and plan expiry policy under deterministic local control.
