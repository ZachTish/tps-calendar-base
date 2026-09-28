# TPS Calendar Base

Calendar and timeline views for Obsidian Bases, using TPS Global Context Menu for shared entity and task behavior.

Current release: [0.16.3](https://github.com/ZachTish/tps-calendar-base/releases/tag/0.16.3) · Obsidian 1.10.0+ · Desktop and mobile.

## 0.16.3 — Keep the resized interval while metadata catches up

Resizing an event now retains its complete pending interval until the displayed start and end both match the saved change. Previously, an unchanged start was enough to clear that pending interval; the first stale Base result could paint the old end again before a later refresh corrected it. This also protects a move whose start has updated while its end is still old. The existing one-second comparison tolerance, five-second expiry and optional-end behavior remain. No new state, timer, cache, refresh event, writer, setting or migration is introduced.

The fix is in Calendar's existing pending-update acknowledgement. GCM still owns the native write and identity verification; Bases still supplies query results. It does not remove the first existing-record edit's global identity check. In the installed test vault, the first move spent about 4.8 seconds verifying 10,678 Markdown sources; that separate authority/performance decision remains unresolved. Repeated edits reuse the verified index.

Eight actual-method regressions cover stale and partial metadata, duration-derived ends, superseding edits, optional ends, expiry and tolerance; five failed before the fix. All 341 declared tests and TypeScript passed. The separate normal build deployed to the test vault; named Calendar reload verified 0.16.3 with settings unchanged. Actual foreground longer/shorter resizes retained the requested end in every render, with two-frame correct layout at 48.2/47.5 ms after confirmation versus 247.6 ms and a stale interval before the fix. Each edit still made one write, two full data passes and four render requests. These small warm desktop samples establish the snap-back correction, not native/production/mobile speed. All consumers remained enabled; the left sidebar was collapsed for geometry, then restored. Body/identity/settings were preserved and fixtures archived.

Regression and installed validation, build/reload details and artifact hashes are recorded in [0.16.3 release notes](release-notes/0.16.3.md). Minimum Obsidian remains 1.10.0. This is a backward-compatible display-correctness patch; no production or native-performance equivalence is claimed.

## 0.16.2 — Let GCM allocate fresh Calendar identities

New native Calendar events now use GCM's existing `createFresh` method when the provider advertises `freshIdentityCreates: true` and supplies that method. The previous caller used the verified-ID creation path even though Calendar never supplied an ID, making the first creation wait for GCM to read every Markdown source for possible identity conflicts. GCM continues to own secure ID allocation, reserved IDs, known conflicts, storage paths, the initial write and mutation events. Older providers retain the existing `create` route; a rejection from `createFresh` propagates without attempting another creation.

Toolbar, range and associated-note creation share this method. Timed/all-day payloads, caller attribution, canonical returned-record checks, post-creation presentation, existing-record edits and Controller synchronization keep their existing contracts. No settings, defaults, cache, timer, watcher, migration, repair or refresh-event redesign is added. Minimum Obsidian remains 1.10.0; the faster route requires a GCM provider with the additive fresh-identity capability (available in the paired GCM 3.6.10 test build).

Twenty new regressions execute the actual Calendar creation method with the real payload and returned-record helpers. Seven fresh-route assertions failed against 0.16.1; all 25 native-boundary checks pass after the caller change, including older/malformed capability declarations, receiver binding, provider errors with no retry, invalid handles, intervals and note associations. All 325 versioned tests, TypeScript and the separate build passed. The build deployed only to the test vault and Calendar was reloaded by its manifest ID.

Two actual foreground Base New actions with GCM 3.6.10, Navigator 7.0.7, Controller 2.6.3 and Health 3.8.1 enabled created one correct event each. After an ordinary GCM reload, the authoritative source index remained cold through both actions: zero identity-refresh calls and zero native source reads. Creation took 54.4/53.8 ms, compared with the prior 3,449.4 ms first-creation sample whose identity refresh occupied 3,403.4 ms. Shared preview completed at 96.6/95.9 ms; event DOM layout at 284/345 ms. These small, instrumented desktop samples are not native-equivalence, cold-app, production or iPhone guarantees. The first after sample used a shorter window; the repeat matched the baseline viewport. UUID identity, title, interval, configured filename and empty body were verified; no outside writes or long tasks were observed. Hooks, original leaf/search and full-screen mode were restored, fixtures archived and five persisted settings files stayed byte-identical. Calendar's five refresh passes remain unchanged. See [0.16.2 release notes](release-notes/0.16.2.md) for evidence limits and artifact hashes. Ready for the user's BRAT pull and acceptance; production is not changed by test-vault validation.

## 0.16.1 — Finish event creation without a second rewrite

Calendar now returns the completed event after its existing template/default/parent processing and optional file linter. It no longer waits an arbitrary 100 ms, rereads the result, deduplicates YAML keys, or rewrites the whole note afterward. That final rewrite could overwrite an editor change made after its read and also removed authored spacing or linter formatting. Plain note creation already writes its complete frontmatter in the initial Vault create call; the regression requires one create and zero follow-up reads, writes or timers when no template, parent or linter is involved.

Configured templates retain their existing order: prepare initial content, run Templater, remove the shared template-instance marker, apply Calendar-owned fields/defaults and optional parent, then invoke the installed linter once. Both supported direct linter methods remain; Calendar does not open another note to run a linter. Shared post-creation preview/open/stay routing is unchanged. No settings, defaults, schema, migration or recovery behavior is added. Existing malformed notes are not repaired by creation.

Four focused lifecycle regressions failed against 0.16.0 and pass after removal, including deterministic concurrent-edit loss through both supported linter methods, valid initial YAML with operation counts, and one owned frontmatter merge after Templater. The full creation suite has 36 checks; creation/opening/mobile coverage has 40 additional checks. Versioned `npm test` passed all 305 checks and TypeScript/build. Installed test-vault QA reproduced the stale-snapshot loss on 0.16.0; 0.16.1 made one create with zero Calendar rereads/rewrites and preserved the concurrent paragraph. A second check used the real Calendar/GCM registry and configured editable-preview handoff: the title, body and frontmatter remained intact after 4.5 seconds, with both settings unchanged. The separate final build deploys only to the test vault; named plugin reload verifies the installed version. Details, timings and artifact hashes are recorded in [0.16.1 release notes](release-notes/0.16.1.md). Native-record creation is a separate unchanged path. Template sequencing is regression-tested; live Templater and physical iPhone behavior were not exercised. Minimum Obsidian remains 1.10.0. Production remains the user's BRAT pull and acceptance.

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


## 0.16.0 — Confirmed current mappings

Global title, status, previous-status, color and icon property controls use Apply, preview and confirmation through GCM 3.0.0 propertyMappings v1. Matching enabled Controller and Health mappings update together. Missing/older GCM blocks changes without saving. Per-view Base property selectors still select existing fields; they are not property-renaming controls.

Minor: adds confirmed migration to global mapping controls. Existing navigation destinations, default routes, disclosures, commands, and persisted UI-state contract are unchanged. Mapping controls are plain inputs with an explicit Apply action and wrapping layouts; no alias editor is added. Cancel preserves the current mapping and notes.

Shared migrations change Markdown frontmatter only, preserve note bodies, reject occupied destinations and stale previews, and keep a local recovery copy until success. Inline fields, Base formulas, per-view configuration, and disabled plugins are not automatically rewritten; enable participating TPS plugins before a shared rename. Review historical records before relying on totals after upgrading. Health timing migration uses its existing guarded rollback flow; a process crash cannot provide a vault-wide atomic transaction. No migration or outbound service runs merely because the plugin is upgraded.

Validation covers current-only reads, migration-only historical inputs, cancellation, archived notes, conflicts, stale previews, save/write rollback, cross-plugin setting changes and identity protection. Required final validation: full declared suite, separate production build to the test vault, named plugin reload and settings confirmation checks. UI and final test results are recorded in the release notes. Minimum Obsidian compatibility is unchanged. Update GCM before applying Controller or Calendar mapping changes. The release is a BRAT handoff; production installation remains user-controlled.

Full declared suite: 301 checks passed, 0 optional/existing checks skipped, zero failed. TypeScript and separate final production builds pass and deploy only shipped artifacts to the test vault; targeted plugin reloads verify the installed versions. Test-vault validation (2026-09-20): Controller’s real Apply dialog previewed one synthetic Markdown note and two plugin mappings. Cancel preserved both mappings and the original file; confirming renamed the property and updated Controller and Calendar together, preserved the body, restored input focus, and removed temporary recovery. Original settings were restored and the fixture archived. GCM’s current kind key and migration controls were inspected. Calendar’s five rendered key inputs and Apply actions were verified. Health’s timing inputs were checked; an existing archived QA note with potentially relevant malformed frontmatter correctly blocked migration with a path-specific error and no changes. Successful Health confirmation, timing conversion, cancellation and rollback are covered by regression tests. No outbound automation was enabled. Existing mobile CSS/layout is retained; physical iOS testing remains user acceptance.
