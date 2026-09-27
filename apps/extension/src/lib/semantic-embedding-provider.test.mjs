import test from 'node:test';
import assert from 'node:assert/strict';

const contexts = [];
let sentMessages = [];
let forceWorkerFailure = false;

globalThis.chrome = {
  offscreen: {
    async createDocument() {},
  },
  runtime: {
    id: 'test-extension',
    getURL(path) {
      return `chrome-extension://test/${path}`;
    },
    async getContexts() {
      return contexts;
    },
    async sendMessage(message) {
      sentMessages.push(message);
      if (forceWorkerFailure) return { ok: false, error: 'fixture neural failure' };
      const neural = message.provider === 'neural';
      const dimensions = neural ? 384 : 192;
      return {
        ok: true,
        modelId: neural ? 'mixedbread-ai/mxbai-embed-xsmall-v1' : 'myalgo-local-hash-embedding',
        modelVersion: neural ? 'transformersjs-local-q8-v2' : 'hash-v1-d192',
        dimensions,
        embeddings: message.texts.map(() => {
          const vector = new Array(dimensions).fill(0);
          vector[0] = 1;
          return vector;
        }),
      };
    },
  },
};

const { createOffscreenEmbeddingProvider } = await import('./semantic-embedding-provider.ts');

test('offscreen embedding provider uses worker transport with stable provider identity', async () => {
  sentMessages = [];
  contexts.splice(0, contexts.length, {
    contextType: 'OFFSCREEN_DOCUMENT',
    documentUrl: 'chrome-extension://test/offscreen-search.html',
  });

  const provider = createOffscreenEmbeddingProvider(192);
  const vectors = await provider.embed(['first', 'second']);

  assert.equal(provider.modelId, 'myalgo-local-hash-embedding');
  assert.equal(provider.modelVersion, 'hash-v1-d192');
  assert.equal(provider.dimensions, 192);
  assert.equal(provider.execution, 'offscreen_worker_with_hash_fallback');
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].target, 'semantic-embedding-offscreen');
  assert.equal(vectors.length, 2);
  assert.equal(vectors[0].length, 192);
});

test('offscreen embedding provider falls back locally when offscreen APIs are unavailable', async () => {
  const originalOffscreen = globalThis.chrome.offscreen;
  globalThis.chrome.offscreen = undefined;

  try {
    const provider = createOffscreenEmbeddingProvider(192);
    const [first] = await provider.embed(['distributed systems']);
    const [second] = await provider.embed(['distributed systems']);
    assert.deepEqual(first, second);
    assert.equal(first.length, 192);
  } finally {
    globalThis.chrome.offscreen = originalOffscreen;
  }
});


test('offscreen neural embedding provider requests packaged neural model identity', async () => {
  sentMessages = [];
  contexts.splice(0, contexts.length, {
    contextType: 'OFFSCREEN_DOCUMENT',
    documentUrl: 'chrome-extension://test/offscreen-search.html',
  });

  const provider = createOffscreenEmbeddingProvider('neural');
  const vectors = await provider.embed(['semantic candidate']);

  assert.equal(provider.modelId, 'mixedbread-ai/mxbai-embed-xsmall-v1');
  assert.equal(provider.modelVersion, 'transformersjs-local-q8-v2');
  assert.equal(provider.dimensions, 384);
  assert.equal(provider.execution, 'offscreen_sandbox_neural');
  assert.equal(sentMessages[0].provider, 'neural');
  assert.equal(sentMessages[0].batchSize, 1);
  assert.equal(vectors[0].length, 384);
});


test('neural provider throws on worker failure so orchestration can fall back with truthful model provenance', async () => {
  sentMessages = [];
  forceWorkerFailure = true;
  contexts.splice(0, contexts.length, {
    contextType: 'OFFSCREEN_DOCUMENT',
    documentUrl: 'chrome-extension://test/offscreen-search.html',
  });

  try {
    const provider = createOffscreenEmbeddingProvider('neural');
    await assert.rejects(
      provider.embed(['semantic candidate']),
      /fixture neural failure/,
    );
  } finally {
    forceWorkerFailure = false;
  }
});


test('neural provider clamps and forwards configured WebGPU batch size', async () => {
  sentMessages = [];
  contexts.splice(0, contexts.length, {
    contextType: 'OFFSCREEN_DOCUMENT',
    documentUrl: 'chrome-extension://test/offscreen-search.html',
  });

  const provider = createOffscreenEmbeddingProvider('neural', { neuralBatchSize: 8 });
  await provider.embed(['one', 'two']);

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].provider, 'neural');
  assert.equal(sentMessages[0].batchSize, 8);
});
