# TPS Calendar Base

Calendar and timeline views for Obsidian Bases, using TPS Global Context Menu for shared entity and task behavior.

Current release: [0.14.0](https://github.com/ZachTish/tps-calendar-base/releases/tag/0.14.0) · Obsidian 1.10.0+ · Desktop and mobile.

## Install with BRAT

Add `ZachTish/tps-calendar-base` to BRAT. Use manual updates with `Latest`, or freeze an exact numeric tag for a controlled rollout. Each release supplies `main.js`, `manifest.json`, and `styles.css`; release notes record validation and artifact hashes. A published release is not evidence that any device has installed it.

## Use a calendar

Enable Obsidian Bases and TPS Global Context Menu, then select the Calendar layout in a Base. Native Base filters select records; the view's property mappings determine their scheduled/start and duration/end fields. Creation honors the active view's defaults before lower-priority Base defaults.

**Display → Date source** has two modes:

- **Filter driven** uses the resolved date-filter range; without one it keeps the ordinary saved-date/today behavior.
- **Embedded/active note driven** follows the embedded host note first, otherwise the active Markdown note's configured scheduled date. Sidebar focus retains the last Markdown context. A missing/invalid date uses today; filenames do not infer it.

Embedded timelines containing today return to now after 20 seconds without scrolling and on refresh. Explicit date navigation remains available. The current-time badge uses a live clock; the view does not rewrite note dates simply because focus changes.

## Two-level Daily Notes — 0.14.0

An explicitly selected task destination with `kind: note` and `noteKind: daily` receives calendar tasks inside its Scheduled section, including when its path differs from the event date. Both values are required, with case-insensitive keys/values and surrounding whitespace ignored. Existing Daily Note path, `kind: dailynote`, and tag recognition remain supported. Other note/task subtypes retain ordinary task placement.

This additive feature preserves the note's metadata and existing section ordering. It introduces no settings, defaults, automatic destination selection, or migration. GCM 2.4.0 supplies shared recognition for Daily Note creation, date lookup and Navigator; update both plugins for the complete workflow. A generic task destination is not converted into a Daily Note.

Regression coverage exercises actual task creation and section placement for complete, missing, mixed, differently cased, and single-value-list pairs, alongside the existing legacy Daily Note suite. Full tests, the separate final build/deployment, reload, and installed paired-plugin QA are recorded in [0.14.0 release notes](release-notes/0.14.0.md). Validation on 2026-09-20 passed all 300 full-suite checks and 32 focused creation checks; TypeScript and the separate final build deployed to the test vault. After `plugin:reload`, the installed Calendar service in a synthetic Calendar Base placed a task inside Scheduled for the named paired Daily Note and used ordinary placement for the `kind: note` control. Their metadata stayed intact; QA fixtures were archived and temporary settings restored. Minimum Obsidian remains 1.10.0; production installation is a separate BRAT update.

## Ownership and settings

Calendar owns presentation, event interactions, and per-view display options. GCM owns shared fields, statuses, entity identity, task creation contracts, and Base formula services. Controller owns external calendar synchronization and reminder scheduling. Configure those services in their owning plugins.

Atomic notes and Atomic lines use their appropriate creation paths. A task creation path requires an explicit destination; the calendar must not invent a Daily Note or generic task sink. Shared Source mode remains literal Markdown.

See [detailed historical reference](REFERENCE.md) for command inventory, source layout, filtering, embedding, mobile modal behavior, and release-specific QA. Unsupported or experimental behavior recorded there is not a current guarantee.

## Development and repository policy

`main` is the stable source line. Numeric tags identify immutable released artifacts. `optimization` is an unreleased work-in-progress lane; do not install it through BRAT or merge it into stable without separate validation.

The supported build lives inside `Obsidian Plugin Test Vault/Plugin Development`, with `TPS-Calendar-Base (Dev)` as the mapped stable source. These repositories depend on adjacent shared tooling including `deploy-runtime.mjs`; a standalone clone is not currently self-contained.

From the contained workspace, prepare dependencies using the shared helper, then run tests and a separate final build:

```sh
# From Plugin Development:
node ./prepare-dependencies.mjs "TPS-Calendar-Base (Dev)"
cd "TPS-Calendar-Base (Dev)"
npm test
npm run build
```

Dependencies stay in the vault's `.plugin-dev-cache.nosync` through a relative `node_modules` symlink. Use a clean, current checkout; preserve unrelated changes and never build an old dirty worktree into the test runtime. Stable builds deploy only shipped artifacts to the test vault. Optimization builds are build-only. Runtime `data.json`, secrets, caches, and session state never belong in Git.

Documentation-only maintenance does not create a new plugin version. Published release tags and assets are preserved. Do not rely on legacy version/release scripts without reviewing their current behavior. Production updates remain the user's BRAT handoff.

For prior feature details and release-specific evidence, see [REFERENCE.md](REFERENCE.md) and [GitHub releases](https://github.com/ZachTish/tps-calendar-base/releases). The September 16 cleanup changes documentation and repository metadata, not shipped behavior.

## 0.15.0 — Shared note creation opening (2026-09-20)

With GCM 2.5.0+, Calendar delegates post-creation preview/open/stay to GCM's **Menus & surfaces → Note opening**. The existing **After creating an item** setting becomes a **Configure note opening** handoff. All Calendar creation callers still use the same dispatcher: toolbar, ranges, dropped items, task destinations, and external-event note creation. Calendar sends the actual resulting file and originating surface; existing daily/task destination files do not enter filename rename mode. Folder/default/template and task-vs-note resolution are unchanged.

For legacy Base-note creation, Calendar asks `api.ui.handlesNativeBaseCreation(controller)` before installing its old create/open observers. A supported native adapter owns the result exactly once and prevents the phone's intermediate tab opening. With older/disabled GCM or an unsupported native adapter, Calendar preserves its previous dispatcher/observer fallback and restores the originating Calendar before asking the shared handler to present a result. The stored `postCreateBehavior` and legacy keys remain for fallback and GCM's one-time migration; no competing controls are displayed while GCM owns opening.

The capability registry remains the integration boundary. `api.ui.presentCreatedNote`, `handlesNativeBaseCreation`, and `openNoteOpeningSettings` are optional additive capabilities. Regression coverage in `scripts/test-create-snap-and-mobile-open.mjs` checks ownership, native observer bypass, settings handoff, existing generation guards, and all creation callers. Validate with `npm test` and a separate `npm run build`, then reload only Calendar in Obsidian Plugin Test Vault. Test artifacts deploy through the shared helper without overwriting runtime data. Physical iPhone acceptance remains for the user's BRAT pull. Minimum Obsidian remains 1.10.0; this minor feature release requires GCM 2.5.0 for shared behavior and retains legacy behavior otherwise.

Final validation: all 301 checks passed and the separate production build deployed to the test vault. After reloading 0.15.0, an embedded Calendar New action created one canonical calendar-event record with its stable identity and schedule, displayed GCM’s preview, and retained the embedded Calendar. The settings button reached GCM’s Note opening controls. Synthetic native storage and opening preferences were restored and QA files archived.
