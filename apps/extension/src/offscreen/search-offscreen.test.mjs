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
const queriedSelectors = [];
globalThis.document = {
  querySelector(selector) {
    queriedSelectors.push(selector);
    return frame;
  },
};

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

  assert.equal(hostMessages[0].type, 'PING');
  const readinessProbeId = hostMessages[0].id;
  window.dispatchEvent(Object.assign(new Event('message'), {
    source: frame.contentWindow,
    data: { source: 'myalgo-neural-sandbox', id: readinessProbeId, type: 'ready' },
  }));
  frame.dispatchEvent(new Event('load'));
  const firstEmbeddingRequest = hostMessages.find((message) => message.type === 'EMBED_TEXTS');
  assert.ok(firstEmbeddingRequest);
  assert.equal(
    hostMessages.filter((message) => message.type === 'EMBED_TEXTS').length,
    1,
  );

  window.dispatchEvent(Object.assign(new Event('message'), {
    source: frame.contentWindow,
    data: {
      source: 'myalgo-neural-sandbox',
      id: firstEmbeddingRequest.id,
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
  const embeddingRequests = hostMessages.filter((message) => message.type === 'EMBED_TEXTS');
  assert.equal(embeddingRequests.length, 2);
  assert.deepEqual(embeddingRequests[1].texts, ['learning mode seed']);

  window.dispatchEvent(Object.assign(new Event('message'), {
    source: frame.contentWindow,
    data: {
      source: 'myalgo-neural-sandbox',
      id: embeddingRequests[1].id,
      ok: true,
      embeddings: [new Array(384).fill(0)],
      modelId: 'mixedbread-ai/mxbai-embed-xsmall-v1',
      modelVersion: 'transformersjs-local-q8-v2',
      dimensions: 384,
    },
  }));
  assert.equal((await secondResult).ok, true);
});


test('a missed one-shot ready event is recovered by an idempotent readiness probe', async () => {
  hostMessages.length = 0;
  frame.contentDocument = null;

  const result = new Promise((resolve) => {
    assert.equal(runtimeListener({
      target: 'semantic-embedding-offscreen',
      type: 'EMBED_TEXTS',
      provider: 'neural',
      texts: ['already loaded sandbox'],
    }, {}, resolve), true);
  });

  const probe = hostMessages.find((message) => message.type === 'PING');
  assert.ok(probe);
  assert.equal(
    hostMessages.some((message) => message.type === 'EMBED_TEXTS'),
    false,
  );

  window.dispatchEvent(Object.assign(new Event('message'), {
    source: frame.contentWindow,
    data: {
      source: 'myalgo-neural-sandbox',
      id: probe.id,
      type: 'ready',
    },
  }));

  const request = hostMessages.find((message) => message.type === 'EMBED_TEXTS');
  assert.ok(request);
  window.dispatchEvent(Object.assign(new Event('message'), {
    source: frame.contentWindow,
    data: {
      source: 'myalgo-neural-sandbox',
      id: request.id,
      ok: true,
      embeddings: [new Array(384).fill(0)],
      modelId: 'mixedbread-ai/mxbai-embed-xsmall-v1',
      modelVersion: 'transformersjs-local-q8-v2',
      dimensions: 384,
    },
  }));

  assert.equal((await result).ok, true);
});


test('concept verification uses an isolated sandbox selector and returns selected labels', async () => {
  hostMessages.length = 0;
  queriedSelectors.length = 0;
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

  assert.ok(queriedSelectors.includes('[data-myalgo-concept-sandbox]'));
  const conceptRequest = hostMessages.find((message) => message.type === 'VERIFY_CONCEPTS');
  assert.ok(conceptRequest);
  assert.deepEqual(conceptRequest.conceptItems, [{
    text: 'distributed systems and CRDT implementation',
    labels: ['distributed systems', 'CRDTs', 'cooking'],
  }]);

  window.dispatchEvent(Object.assign(new Event('message'), {
    source: frame.contentWindow,
    data: {
      source: 'myalgo-neural-sandbox',
      id: conceptRequest.id,
      modelKind: 'concept',
      ok: true,
      concepts: [['distributed systems', 'CRDTs']],
      modelId: 'Xenova/nli-deberta-v3-xsmall',
      modelVersion: 'transformersjs-local-q8-wasm-v1',
      backend: 'wasm-sandbox',
    },
  }));

  assert.deepEqual(await result, {
    ok: true,
    concepts: [['distributed systems', 'CRDTs']],
    modelId: 'Xenova/nli-deberta-v3-xsmall',
    modelVersion: 'transformersjs-local-q8-wasm-v1',
    backend: 'wasm-sandbox',
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

  const conceptRequest = hostMessages.find((message) => message.type === 'VERIFY_CONCEPTS');
  assert.ok(conceptRequest);
  window.dispatchEvent(Object.assign(new Event('message'), {
    source: frame.contentWindow,
    data: {
      source: 'myalgo-neural-sandbox',
      id: conceptRequest.id,
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
