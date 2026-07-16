# TPS-Calendar-Base (Dev) — Audit

Scope
- Reviewed files: [`src/main.ts`](/Users/zachtisherman/TishOS%20v0.1/.obsidian/plugins/TPS-Calendar-Base%20(Dev)/src/main.ts), [`src/tps-controller-api.ts`](/Users/zachtisherman/TishOS%20v0.1/.obsidian/plugins/TPS-Calendar-Base%20(Dev)/src/tps-controller-api.ts), [`src/services/new-event-service.ts`](/Users/zachtisherman/TishOS%20v0.1/.obsidian/plugins/TPS-Calendar-Base%20(Dev)/src/services/new-event-service.ts), [`src/utils/task-target-path.ts`](/Users/zachtisherman/TishOS%20v0.1/.obsidian/plugins/TPS-Calendar-Base%20(Dev)/src/utils/task-target-path.ts).

Where issues are
- High: Multiple plugin integrations are still resolved by manual legacy-id probing and permissive casts; a single contract mismatch can fail event creation without a clear error.
- High: Target-path resolution can be ambiguous because filter/default resolution and legacy fallback values coexist in one code path, so the same event can route differently based on active view history.
- High: `task`/`note` decisioning is spread across command entrypoints, which makes it easy for one entrypoint to diverge from another and produce inconsistent behavior.
- Medium: `new-event-service.ts` mixes transport formatting, target resolution, and file mutation in one service, making rollback and retry behavior difficult.
- Medium: Frontmatter/path helpers in `task-target-path.ts` accept markdown-like path input with limited normalization; edge cases with escaped characters, non-existent folders, and link-only syntax can generate wrong sinks.
- Low: Polling checks on active workspace state duplicate existing Obsidian events and can keep stale handlers alive across mode transitions.

User interaction risks
- Event creation path can vary by view context and appear to “switch destinations” unexpectedly.
- Duplicate writes are possible when the same event creation command passes through multiple routing branches.
- Users may lose trust when event creation silently targets the fallback note or old default path.

Improvements
- Move all destination resolution into a single pure resolver with explicit return shape `{ mode, targetFile, rationale, source }` and deterministic precedence.
- Introduce a shared contract checker for Controller/GCM/Messager dependencies before command execution.
- Convert polling branches to workspace event subscriptions (`active-leaf-change`, `file-open`, `layout-change`) and register/unregister per mode transition.
- Separate responsibilities in `NewEventService`:
  - decision service for mode/path
  - canonical payload serializer
  - mutation service for file operations
- Enforce strict path normalization for all incoming target values, including bracketed and malformed forms, with structured rejection notices.

How to simplify/centralize
- Add a shared `tps-task-target-resolution` module used by Calendar + Kanban + Controller:
  - same active-view-first precedence
  - same path parser and sanitize rules
  - shared fallback policy
- Add `tps-api-registry` module for all cross-plugin lookups and capability checks.
- Define a single event creation contract shared by all command producers and consumers.
