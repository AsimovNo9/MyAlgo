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
        modelId: 'onnx-community/SmolLM2-135M-Instruct-ONNX-MHA',
        modelVersion: 'transformersjs-local-q8-v1',
        backend: 'webgpu-sandbox',
        outputs: message.prompts.map((_prompt, index) => (
          index === 0
            ? 'Silent Hill, survival horror, puzzle games'
            : 'local LLMs, WebGPU inference'
        )),
      };
    },
  },
};

const { createLocalConceptExtractionProvider } =
  await import('./concept-extraction-provider.ts');

test('local concept provider uses offscreen transport and conservative parser', async () => {
  sentMessages = [];
  contexts.splice(0, contexts.length, {
    contextType: 'OFFSCREEN_DOCUMENT',
    documentUrl: 'chrome-extension://test/offscreen-search.html',
  });

  const provider = createLocalConceptExtractionProvider();
  const result = await provider.extract(['first prompt', 'second prompt']);

  assert.equal(provider.modelId, 'onnx-community/SmolLM2-135M-Instruct-ONNX-MHA');
  assert.equal(provider.modelVersion, 'transformersjs-local-q8-v1');
  assert.equal(provider.execution, 'offscreen_sandbox_text_generation');
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].type, 'EXTRACT_CONCEPTS');
  assert.deepEqual(result.concepts, [
    ['Silent Hill', 'survival horror', 'puzzle games'],
    ['local LLMs', 'WebGPU inference'],
  ]);
  assert.equal(result.backend, 'webgpu-sandbox');
});

test('local concept provider throws instead of fabricating model output on failure', async () => {
  forceFailure = true;
  contexts.splice(0, contexts.length, {
    contextType: 'OFFSCREEN_DOCUMENT',
    documentUrl: 'chrome-extension://test/offscreen-search.html',
  });
  try {
    await assert.rejects(
      createLocalConceptExtractionProvider().extract(['prompt']),
      /fixture concept failure/,
    );
  } finally {
    forceFailure = false;
  }
});
