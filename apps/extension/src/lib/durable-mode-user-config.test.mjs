import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyDurableModeUserConfig,
  createEmptyDurableModeUserConfig,
  undoLastDurableModeUserConfigEdit,
  updateDurableModeUserConfig,
} from './durable-mode-user-config.ts';

const catalog = {
  pipelineId: 'durable-semantic-modes-v1',
  graphRevision: 7,
  generatedAt: '2026-10-01T12:00:00.000Z',
  modes: [{
    id: 'mode:a',
    label: 'Programming',
    inferredLabel: 'Programming',
    revision: 3,
    members: [{
      canonicalId: 'canonical:programming',
      label: 'Programming',
      weight: 1,
      sourceNodeIds: ['topic:programming'],
      supportContentIds: ['content:a', 'content:b'],
    }],
    provenance: 'inferred',
    pipelineId: 'durable-semantic-modes-v1',
    graphRevision: 7,
    createdAt: '2026-09-30T12:00:00.000Z',
    lastSupportedAt: '2026-10-01T12:00:00.000Z',
    active: true,
    pinned: false,
  }],
};

test('rename and pin are revisioned independently of semantic mode revision', () => {
  let state = createEmptyDurableModeUserConfig();
  state = updateDurableModeUserConfig(
    state,
    'mode:a',
    { label: 'Deep work' },
    '2026-10-01T13:00:00.000Z',
  );
  state = updateDurableModeUserConfig(
    state,
    'mode:a',
    { pinned: true },
    '2026-10-01T13:01:00.000Z',
  );

  assert.equal(state.currentRevision, 2);
  assert.equal(state.revisions[0].action, 'rename');
  assert.equal(state.revisions[1].action, 'pin');

  const applied = applyDurableModeUserConfig(catalog, state);
  assert.equal(applied.modes[0].label, 'Deep work');
  assert.equal(applied.modes[0].inferredLabel, 'Programming');
  assert.equal(applied.modes[0].revision, 3);
  assert.equal(applied.modes[0].pinned, true);
});

test('undo reverses the latest ownership edit without discarding revision history', () => {
  let state = createEmptyDurableModeUserConfig();
  state = updateDurableModeUserConfig(state, 'mode:a', { label: 'Deep work' }, '2026-10-01T13:00:00.000Z');
  state = updateDurableModeUserConfig(state, 'mode:a', { pinned: true }, '2026-10-01T13:01:00.000Z');

  const firstUndo = undoLastDurableModeUserConfigEdit(state, '2026-10-01T13:02:00.000Z');
  assert.equal(firstUndo.reverted?.action, 'pin');
  assert.equal(firstUndo.state.currentRevision, 3);
  assert.equal(firstUndo.state.overrides['mode:a'].label, 'Deep work');
  assert.equal(firstUndo.state.overrides['mode:a'].pinned, undefined);
  assert.equal(firstUndo.state.revisions.at(-1).action, 'undo');
  assert.equal(firstUndo.state.revisions.at(-1).revertsRevision, 2);

  const secondUndo = undoLastDurableModeUserConfigEdit(firstUndo.state, '2026-10-01T13:03:00.000Z');
  assert.equal(secondUndo.reverted?.action, 'rename');
  assert.equal(secondUndo.state.currentRevision, 4);
  assert.equal(secondUndo.state.overrides['mode:a'], undefined);
});

test('reset label restores inferred label while preserving explicit pin', () => {
  let state = createEmptyDurableModeUserConfig();
  state = updateDurableModeUserConfig(state, 'mode:a', { label: 'Deep work' });
  state = updateDurableModeUserConfig(state, 'mode:a', { pinned: true });
  state = updateDurableModeUserConfig(state, 'mode:a', { label: null });

  const applied = applyDurableModeUserConfig(catalog, state);
  assert.equal(applied.modes[0].label, 'Programming');
  assert.equal(applied.modes[0].pinned, true);
  assert.equal(state.revisions.at(-1).action, 'reset_label');
});

test('selection is not represented by ownership config pin state', () => {
  const applied = applyDurableModeUserConfig(catalog, createEmptyDurableModeUserConfig());
  assert.equal(applied.modes[0].pinned, false);
});
