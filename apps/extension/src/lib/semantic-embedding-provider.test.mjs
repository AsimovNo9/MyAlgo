import test from 'node:test';
import assert from 'node:assert/strict';

const contexts = [];
let sentMessages = [];

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
      return {
        ok: true,
        modelId: 'myalgo-local-hash-embedding',
        modelVersion: 'hash-v1-d192',
        dimensions: 192,
        embeddings: message.texts.map(() => {
          const vector = new Array(192).fill(0);
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
