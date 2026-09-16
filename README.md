# TPS Calendar Base

Calendar and timeline views for Obsidian Bases, using TPS Global Context Menu for shared entity and task behavior.

Current release: [0.13.0](https://github.com/ZachTish/tps-calendar-base/releases/tag/0.13.0) · Obsidian 1.10.0+ · Desktop and mobile.

## Install with BRAT

Add `ZachTish/tps-calendar-base` to BRAT. Use manual updates with `Latest`, or freeze an exact numeric tag for a controlled rollout. Each release supplies `main.js`, `manifest.json`, and `styles.css`; release notes record validation and artifact hashes. A published release is not evidence that any device has installed it.

## Use a calendar

Enable Obsidian Bases and TPS Global Context Menu, then select the Calendar layout in a Base. Native Base filters select records; the view's property mappings determine their scheduled/start and duration/end fields. Creation honors the active view's defaults before lower-priority Base defaults.

**Display → Date source** has two modes:

- **Filter driven** uses the resolved date-filter range; without one it keeps the ordinary saved-date/today behavior.
- **Embedded/active note driven** follows the embedded host note first, otherwise the active Markdown note's configured scheduled date. Sidebar focus retains the last Markdown context. A missing/invalid date uses today; filenames do not infer it.

Embedded timelines containing today return to now after 20 seconds without scrolling and on refresh. Explicit date navigation remains available. The current-time badge uses a live clock; the view does not rewrite note dates simply because focus changes.

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
