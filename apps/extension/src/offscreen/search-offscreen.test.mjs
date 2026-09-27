import test from 'node:test';
import assert from 'node:assert/strict';

const hostMessages = [];
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
    sendMessage: async () => ({ ok: true }),
  },
};

await import('./search-offscreen.ts');

test('sandbox ready and iframe load dispatch each neural request only once', async () => {
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
});
