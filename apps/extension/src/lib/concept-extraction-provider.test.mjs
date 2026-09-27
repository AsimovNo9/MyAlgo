import test from 'node:test';
import assert from 'node:assert/strict';

const contexts = [];
let sentMessages = [];
let forceFailure = false;

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
      if (forceFailure) return { ok: false, error: 'fixture concept failure' };
      return {
        ok: true,
        modelId: 'Xenova/DeBERTa-v3-xsmall-mnli-fever-anli-ling-binary',
        modelVersion: 'transformersjs-local-q8-v1',
        backend: 'webgpu-sandbox',
        concepts: message.conceptItems.map((_item, index) => (
          index === 0
            ? ['Silent Hill', 'survival horror']
            : ['local LLMs', 'WebGPU inference']
        )),
      };
    },
  },
};

const { createLocalConceptExtractionProvider } =
  await import('./concept-extraction-provider.ts');

test('local concept provider sends bounded zero-shot verification items', async () => {
  sentMessages = [];
  contexts.splice(0, contexts.length, {
    contextType: 'OFFSCREEN_DOCUMENT',
    documentUrl: 'chrome-extension://test/offscreen-search.html',
  });

  const provider = createLocalConceptExtractionProvider();
  const result = await provider.verify([
    { text: 'Silent Hill survival horror walkthrough', labels: ['Silent Hill', 'survival horror'] },
    { text: 'Local LLM WebGPU tooling', labels: ['local LLMs', 'WebGPU inference'] },
  ]);

  assert.equal(provider.modelId, 'Xenova/DeBERTa-v3-xsmall-mnli-fever-anli-ling-binary');
  assert.equal(provider.modelVersion, 'transformersjs-local-q8-v1');
  assert.equal(provider.execution, 'offscreen_sandbox_zero_shot_classification');
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].type, 'VERIFY_CONCEPTS');
  assert.equal(sentMessages[0].conceptItems.length, 2);
  assert.deepEqual(result.concepts, [
    ['Silent Hill', 'survival horror'],
    ['local LLMs', 'WebGPU inference'],
  ]);
  assert.equal(result.backend, 'webgpu-sandbox');
});

test('local concept provider throws instead of fabricating verifier output on failure', async () => {
  forceFailure = true;
  contexts.splice(0, contexts.length, {
    contextType: 'OFFSCREEN_DOCUMENT',
    documentUrl: 'chrome-extension://test/offscreen-search.html',
  });
  try {
    await assert.rejects(
      createLocalConceptExtractionProvider().verify([
        { text: 'fixture', labels: ['fixture topic'] },
      ]),
      /fixture concept failure/,
    );
  } finally {
    forceFailure = false;
  }
});
