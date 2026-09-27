import test from 'node:test';
import assert from 'node:assert/strict';

import { createPriorityNeuralScheduler } from './neural-request-scheduler.ts';

test('concept work preempts a multi-batch embedding request after the current batch', async () => {
  const order = [];
  let embeddingStep = 0;
  let resolveEmbedding;
  let resolveConcept;
  const embeddingDone = new Promise((resolve) => { resolveEmbedding = resolve; });
  const conceptDone = new Promise((resolve) => { resolveConcept = resolve; });

  const scheduler = createPriorityNeuralScheduler(async () => {
    await Promise.resolve();
  });

  assert.equal(scheduler.enqueue({
    id: 'embedding-1',
    kind: 'embedding',
    async step() {
      embeddingStep += 1;
      order.push(`embedding-${embeddingStep}`);
      return embeddingStep >= 3 ? 'done' : 'yield';
    },
    onDone() {
      resolveEmbedding();
    },
  }), true);

  assert.equal(scheduler.enqueue({
    id: 'concept-1',
    kind: 'concept',
    async step() {
      order.push('concept');
      return 'done';
    },
    onDone() {
      resolveConcept();
    },
  }), true);

  await Promise.all([embeddingDone, conceptDone]);
  assert.deepEqual(order, [
    'embedding-1',
    'concept',
    'embedding-2',
    'embedding-3',
  ]);
});

test('scheduler rejects a duplicate request id until the original finishes', async () => {
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  const scheduler = createPriorityNeuralScheduler();

  assert.equal(scheduler.enqueue({
    id: 'same-id',
    kind: 'concept',
    async step() {
      await blocked;
      return 'done';
    },
    onDone() {
      resolveDone();
    },
  }), true);

  assert.equal(scheduler.enqueue({
    id: 'same-id',
    kind: 'concept',
    async step() {
      return 'done';
    },
  }), false);

  release();
  await done;
  assert.equal(scheduler.isQueued('same-id'), false);
});
