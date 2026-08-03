import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

async function loadRegistry() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL('../src/tps-gcm-api.ts', import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    plugins: [{
      name: 'obsidian-stub',
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/u }, () => ({ path: 'obsidian', namespace: 'stub' }));
        builder.onLoad({ filter: /^obsidian$/u, namespace: 'stub' }, () => ({
          loader: 'js',
          contents: 'export class TFile {}',
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`);
}

function createWorkspace() {
  const listeners = new Map();
  const emissions = [];
  return {
    emissions,
    on(name, callback) {
      const callbacks = listeners.get(name) ?? new Set();
      callbacks.add(callback);
      listeners.set(name, callbacks);
      return { name, callback };
    },
    offref(ref) {
      listeners.get(ref?.name)?.delete(ref?.callback);
    },
    trigger(name, payload) {
      emissions.push({ name, payload });
      for (const callback of [...(listeners.get(name) ?? [])]) callback(payload);
    },
  };
}

function createOwner(workspace) {
  const cleanups = [];
  const refs = [];
  return {
    register(callback) {
      cleanups.push(callback);
    },
    registerEvent(ref) {
      refs.push(ref);
    },
    unload() {
      for (const ref of refs.splice(0)) workspace.offref(ref);
      for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    },
  };
}

function availablePayload(api) {
  return {
    source: 'tps-global-context-menu',
    sourcePluginId: 'tps-global-context-menu',
    timestamp: Date.now(),
    available: true,
    api,
    taskCheckboxesVersion: api?.taskCheckboxes?.version ?? null,
  };
}

test('GCM capability discovery uses only the exact public workspace handshake', async () => {
  const source = readFileSync(new URL('../src/tps-gcm-api.ts', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const view = readFileSync(new URL('../src/calendar-view.tsx', import.meta.url), 'utf8');
  const newEvent = readFileSync(new URL('../src/services/new-event-service.ts', import.meta.url), 'utf8');
  const typeFolders = readFileSync(new URL('../src/services/type-folder-service.ts', import.meta.url), 'utf8');
  const parentLinks = readFileSync(new URL('../src/services/parent-child-link.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\.plugins\b|getPlugin\(|TPS-Global-Context-Menu \(Dev\)/u);
  for (const consumer of [main, view, newEvent, typeFolders, parentLinks]) {
    assert.doesNotMatch(
      consumer,
      /getPluginById\([^\n]*tps-global-context-menu|getPluginSettings\([^\n]*tps-global-context-menu|TPS-Global-Context-Menu \(Dev\)/u,
    );
  }
  assert.match(main, /installGcmApiRegistry\(this, this\.app\)/u);
  assert.match(main, /getGcmStatusOptions\(this\.app\)/u);
  assert.match(view, /return getGcmApi\(this\.app\)/u);
  assert.match(newEvent, /isGcmInlinePropertyAllowed\(this\.config\.app, normalized\)/u);
  assert.match(typeFolders, /const TYPE_TEMPLATE_ROOT = ["']System\/Templates\/Types["']/u);
  assert.match(parentLinks, /getGcmParentLinkPolicy\(app\)/u);

  const { getGcmApi, installGcmApiRegistry } = await loadRegistry();
  const workspace = createWorkspace();
  const app = { workspace };
  const owner = createOwner(workspace);
  const api = { status: { getStatusOptions: () => ['todo'] } };

  workspace.on('tps:gcm-api-request', (payload) => {
    assert.equal(payload.sourcePluginId, 'tps-calendar-base');
    assert.equal(payload.requester, 'tps-calendar-base');
    workspace.trigger('tps:gcm-api-changed', availablePayload(api));
  });
  installGcmApiRegistry(owner, app);

  assert.equal(getGcmApi(app), api, 'listener is registered before the synchronous request response');
  assert.equal(workspace.emissions[0].name, 'tps:gcm-api-request');
  owner.unload();
  assert.equal(getGcmApi(app), null);
});

test('registry supports late load, replacement, unload, and rejects spoofed or malformed payloads', async () => {
  const { getGcmApi, installGcmApiRegistry, onGcmApiChanged } = await loadRegistry();
  const workspace = createWorkspace();
  const app = { workspace };
  const owner = createOwner(workspace);
  const changes = [];

  installGcmApiRegistry(owner, app);
  onGcmApiChanged(owner, app, (next, previous) => changes.push([next, previous]));
  assert.equal(getGcmApi(app), null);

  const first = { id: 'first' };
  workspace.trigger('tps:gcm-api-changed', {
    ...availablePayload(first),
    sourcePluginId: 'TPS-Global-Context-Menu (Dev)',
  });
  workspace.trigger('tps:gcm-api-changed', {
    ...availablePayload(first),
    source: 'another-plugin',
  });
  workspace.trigger('tps:gcm-api-changed', {
    ...availablePayload(first),
    api: null,
  });
  assert.equal(getGcmApi(app), null);
  assert.deepEqual(changes, []);

  workspace.trigger('tps:gcm-api-changed', availablePayload(first));
  const second = { id: 'second' };
  workspace.trigger('tps:gcm-api-changed', availablePayload(second));
  workspace.trigger('tps:gcm-api-changed', {
    source: 'tps-global-context-menu',
    sourcePluginId: 'tps-global-context-menu',
    timestamp: Date.now(),
    available: false,
    api: first,
  });
  assert.equal(getGcmApi(app), null);
  assert.deepEqual(changes, [
    [first, null],
    [second, first],
    [null, second],
  ]);
  owner.unload();
});

test('typed status, task-checkbox, inline-property, and parent-link capabilities validate version, output, and failures', async () => {
  const {
    getGcmParentLinkPolicy,
    getGcmStatusOptions,
    getGcmTaskCheckboxIconForState,
    getGcmTaskCheckboxStateForStatus,
    getGcmTaskStatusForCheckboxState,
    installGcmApiRegistry,
    isGcmInlinePropertyAllowed,
    normalizeGcmTaskCheckboxState,
  } = await loadRegistry();
  const workspace = createWorkspace();
  const app = { workspace };
  const owner = createOwner(workspace);
  installGcmApiRegistry(owner, app);

  const mappings = Object.freeze([
    Object.freeze({ checkboxState: '[ ]', statuses: Object.freeze(['todo']), toggleTargetStatus: 'complete', icon: 'square' }),
    Object.freeze({ checkboxState: '[x]', statuses: Object.freeze(['complete']), toggleTargetStatus: 'todo', icon: 'square-check-big' }),
    Object.freeze({ checkboxState: '[/]', statuses: Object.freeze(['working']), toggleTargetStatus: 'complete', icon: 'square-play' }),
  ]);
  workspace.trigger('tps:gcm-api-changed', availablePayload({
    status: {
      values: [' todo ', '', null, 'complete'],
      getStatusOptions() { return this.values; },
    },
    taskCheckboxes: {
      version: 1,
      contract: 'ordered-strict-v1',
      getMappings: () => mappings,
      stateForStatus: (status) => status === 'working' ? '[/]' : status === 'complete' ? '[X]' : status === 'todo' ? '[ ]' : '',
      statusForState: (state) => state === '[/]' ? 'working' : state === '[x]' ? 'complete' : state === '[ ]' ? 'todo' : '',
    },
    configuration: {
      version: 1,
      isInlinePropertyAllowed: (key) => key === 'client',
      getParentLinkPolicy: () => ({
        format: 'markdown-title',
        tag: ['parent-linked'],
        autoSelfLink: true,
      }),
    },
  }));
  assert.deepEqual(getGcmStatusOptions(app), ['todo', 'complete']);
  assert.equal(getGcmTaskCheckboxStateForStatus(app, 'working'), '[/]');
  assert.equal(getGcmTaskCheckboxStateForStatus(app, 'complete'), '[x]');
  assert.equal(getGcmTaskCheckboxStateForStatus(app, 'unknown'), null);
  assert.equal(getGcmTaskStatusForCheckboxState(app, '[/]'), 'working');
  assert.equal(getGcmTaskStatusForCheckboxState(app, '[?]'), null);
  assert.equal(getGcmTaskCheckboxIconForState(app, '[X]'), 'square-check-big');
  assert.equal(normalizeGcmTaskCheckboxState(''), null);
  assert.equal(normalizeGcmTaskCheckboxState('[😀]'), null);
  assert.equal(isGcmInlinePropertyAllowed(app, 'client'), true);
  assert.equal(isGcmInlinePropertyAllowed(app, 'private'), false);
  assert.deepEqual(getGcmParentLinkPolicy(app), {
    format: 'markdown-title',
    tag: ['parent-linked'],
    autoSelfLink: true,
  });

  workspace.trigger('tps:gcm-api-changed', availablePayload({
    taskCheckboxes: {
      version: 1,
      contract: 'ordered-strict-v1',
      getMappings: () => mappings,
      stateForStatus: (status) => {
        const normalized = String(status || '').trim().toLowerCase();
        return normalized === 'working' ? '[/]' : normalized === 'complete' ? '[x]' : '[ ]';
      },
      statusForState: (state) => state === '[/]' ? 'working' : state === '[x]' ? 'complete' : state === '[ ]' ? 'todo' : '',
    },
  }));
  assert.equal(getGcmTaskCheckboxStateForStatus(app, ' working '), '[/]');
  assert.equal(
    getGcmTaskCheckboxStateForStatus(app, 'not-configured'),
    null,
    'a provider fallback cannot map a status absent from the ordered snapshot',
  );

  workspace.trigger('tps:gcm-api-changed', availablePayload({
    status: { getStatusOptions: () => { throw new Error('not ready'); } },
    taskCheckboxes: {
      version: 1,
      contract: 'ordered-strict-v1',
      getMappings: () => [],
      stateForStatus: () => '[custom]',
      statusForState: () => { throw new Error('not ready'); },
    },
    configuration: {
      version: 2,
      isInlinePropertyAllowed: () => true,
      getParentLinkPolicy: () => ({ format: 'markdown-title', autoSelfLink: true }),
    },
  }));
  assert.deepEqual(getGcmStatusOptions(app), []);
  assert.equal(getGcmTaskCheckboxStateForStatus(app, 'working'), null, 'malformed markers fail closed');
  assert.equal(getGcmTaskStatusForCheckboxState(app, '[/]'), null, 'provider failures fail closed');
  assert.equal(isGcmInlinePropertyAllowed(app, 'client'), false, 'unknown configuration versions fail closed');
  assert.equal(getGcmParentLinkPolicy(app), null);

  workspace.trigger('tps:gcm-api-changed', availablePayload({
    taskCheckboxes: {
      version: 2,
      contract: 'ordered-strict-v1',
      getMappings: () => mappings,
      stateForStatus: () => '[x]',
      statusForState: () => 'complete',
    },
  }));
  assert.equal(getGcmTaskCheckboxStateForStatus(app, 'complete'), null, 'unknown task-checkbox versions fail closed');
  assert.equal(getGcmTaskStatusForCheckboxState(app, '[x]'), null);

  workspace.trigger('tps:gcm-api-changed', availablePayload({
    taskCheckboxes: {
      version: 1,
      contract: 'ordered-strict-v1',
      getMappings: () => mappings,
      stateForStatus: () => '[x]',
      statusForState: (state) => state === '[x]' ? 'todo' : '',
    },
  }));
  assert.equal(getGcmTaskCheckboxStateForStatus(app, 'complete'), null, 'cross-method inconsistencies invalidate the snapshot');
  assert.equal(getGcmTaskStatusForCheckboxState(app, '[x]'), null);
  owner.unload();
});
