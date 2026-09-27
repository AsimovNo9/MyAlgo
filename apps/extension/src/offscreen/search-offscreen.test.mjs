import test from 'node:test';
import assert from 'node:assert/strict';

const hostMessages = [];
const runtimeMessages = [];
const frame = new EventTarget();
frame.contentWindow = { postMessage: (message) => hostMessages.push(message) };
frame.contentDocument = { readyState: 'loading' };

globalThis.Worker = class {};
globalThis.window = new EventTarget();
window.setTimeout = setTimeout;
window.clearTimeout = clearTimeout;
globalThis.document = { querySelector: () => frame };

let runtimeListener;
globalThis.chrome = {
  runtime: {
    onMessage: { addListener: (listener) => { runtimeListener = listener; } },
    sendMessage: async (message) => { runtimeMessages.push(message); return { ok: true }; },
  },
};

await import('./search-offscreen.ts');

test('ready and load dispatch once, then an opaque-origin iframe accepts a second request', async () => {
  const result = new Promise((resolve) => {
    assert.equal(runtimeListener({
      target: 'semantic-embedding-offscreen',
      type: 'EMBED_TEXTS',
      provider: 'neural',
      texts: ['candidate'],
    }, {}, resolve), true);
  });

  window.dispatchEvent(Object.assign(new Event('message'), {
    source: frame.contentWindow,
    data: { source: 'myalgo-neural-sandbox', type: 'ready' },
  }));
  frame.dispatchEvent(new Event('load'));
  assert.equal(hostMessages.length, 1);

  window.dispatchEvent(Object.assign(new Event('message'), {
    source: frame.contentWindow,
    data: {
      source: 'myalgo-neural-sandbox',
      id: hostMessages[0].id,
      ok: true,
      embeddings: [new Array(384).fill(0)],
      modelId: 'mixedbread-ai/mxbai-embed-xsmall-v1',
      modelVersion: 'transformersjs-local-q8-v2',
      dimensions: 384,
    },
  }));
  assert.equal((await result).ok, true);

  // Sandboxed extension pages have an opaque origin. contentDocument cannot
  // reveal that this already-loaded iframe is ready for the mode-seed request.
  frame.contentDocument = null;
  const secondResult = new Promise((resolve) => {
    runtimeListener({
      target: 'semantic-embedding-offscreen',
      type: 'EMBED_TEXTS',
      provider: 'neural',
      texts: ['learning mode seed'],
    }, {}, resolve);
  });
  assert.equal(hostMessages.length, 2);
  assert.deepEqual(hostMessages[1].texts, ['learning mode seed']);

  window.dispatchEvent(Object.assign(new Event('message'), {
    source: frame.contentWindow,
    data: {
      source: 'myalgo-neural-sandbox',
      id: hostMessages[1].id,
      ok: true,
      embeddings: [new Array(384).fill(0)],
      modelId: 'mixedbread-ai/mxbai-embed-xsmall-v1',
      modelVersion: 'transformersjs-local-q8-v2',
      dimensions: 384,
    },
  }));
  assert.equal((await secondResult).ok, true);
});


test('concept verification reuses the local neural sandbox and returns selected labels', async () => {
  hostMessages.length = 0;
  frame.contentDocument = null;

  const result = new Promise((resolve) => {
    assert.equal(runtimeListener({
      target: 'semantic-embedding-offscreen',
      type: 'VERIFY_CONCEPTS',
      conceptItems: [{
        text: 'distributed systems and CRDT implementation',
        labels: ['distributed systems', 'CRDTs', 'cooking'],
      }],
    }, {}, resolve), true);
  });

  assert.equal(hostMessages.length, 1);
  assert.equal(hostMessages[0].type, 'VERIFY_CONCEPTS');
  assert.deepEqual(hostMessages[0].conceptItems, [{
    text: 'distributed systems and CRDT implementation',
    labels: ['distributed systems', 'CRDTs', 'cooking'],
  }]);

  window.dispatchEvent(Object.assign(new Event('message'), {
    source: frame.contentWindow,
    data: {
      source: 'myalgo-neural-sandbox',
      id: hostMessages[0].id,
      modelKind: 'concept',
      ok: true,
      concepts: [['distributed systems', 'CRDTs']],
      modelId: 'Xenova/DeBERTa-v3-xsmall-mnli-fever-anli-ling-binary',
      modelVersion: 'transformersjs-local-q8-v1',
      backend: 'webgpu-sandbox',
    },
  }));

  assert.deepEqual(await result, {
    ok: true,
    concepts: [['distributed systems', 'CRDTs']],
    modelId: 'Xenova/DeBERTa-v3-xsmall-mnli-fever-anli-ling-binary',
    modelVersion: 'transformersjs-local-q8-v1',
    backend: 'webgpu-sandbox',
  });
});


test('concept verification persists an explicit runtime error status', async () => {
  hostMessages.length = 0;
  runtimeMessages.length = 0;
  frame.contentDocument = null;

  const result = new Promise((resolve) => {
    assert.equal(runtimeListener({
      target: 'semantic-embedding-offscreen',
      type: 'VERIFY_CONCEPTS',
      conceptItems: [{ text: 'fixture', labels: ['fixture'] }],
    }, {}, resolve), true);
  });

  assert.equal(hostMessages.length, 1);
  window.dispatchEvent(Object.assign(new Event('message'), {
    source: frame.contentWindow,
    data: {
      source: 'myalgo-neural-sandbox',
      id: hostMessages[0].id,
      modelKind: 'concept',
      ok: false,
      error: 'fixture model load failed',
      backend: 'wasm-sandbox',
    },
  }));

  const response = await result;
  assert.equal(response.ok, false);
  assert.match(response.error, /fixture model load failed/);

  const statusMessages = runtimeMessages.filter((message) => (
    message?.type === 'CONCEPT_MODEL_STATUS'
  ));
  assert.ok(statusMessages.length >= 1);
  assert.equal(statusMessages.at(-1).payload.status, 'error');
  assert.equal(statusMessages.at(-1).payload.error, 'fixture model load failed');
});
