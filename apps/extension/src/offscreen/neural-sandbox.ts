import { env, pipeline } from '@huggingface/transformers';
import ortMjsUrl from 'onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortWasmUrl from 'onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm?url';

const NEURAL_MODEL_ID = 'mixedbread-ai/mxbai-embed-xsmall-v1';
const NEURAL_MODEL_VERSION = 'transformersjs-webgpu-q8-v1';
const NEURAL_DIMENSIONS = 384;

type FeatureExtractionPipeline = {
  (texts: string[], options: { pooling: 'mean'; normalize: true }): Promise<{ tolist(): unknown }>;
};

type NeuralSandboxRequest = {
  source?: 'myalgo-neural-host';
  id?: string;
  type?: 'EMBED_TEXTS';
  texts?: string[];
};

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;
let activeRequestId: string | null = null;

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = new URL('./models/', window.location.href).href;
// Chrome extension sandbox pages use an opaque origin and cannot access
// CacheStorage because extension sandbox CSP cannot opt into allow-same-origin.
env.useBrowserCache = false;
env.useWasmCache = false;
// ONNX Runtime defaults these executable runtime files to a CDN. MV3 must
// execute only code packaged with the extension, so force both URLs to Vite-
// emitted local assets. Model/configuration files are also packaged at build
// time under env.localModelPath; runtime remote-model loading is disabled.
env.backends.onnx.wasm!.wasmPaths = {
  mjs: new URL(ortMjsUrl, window.location.href).href,
  wasm: new URL(ortWasmUrl, window.location.href).href,
};

const postToHost = (message: Record<string, unknown>) => {
  window.parent.postMessage({
    source: 'myalgo-neural-sandbox',
    ...message,
  }, '*');
};

async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!('gpu' in navigator)) {
    throw new Error('WebGPU is unavailable in this browser.');
  }

  if (!extractorPromise) {
    extractorPromise = pipeline(
      'feature-extraction',
      'mxbai-embed-xsmall-v1',
      {
        device: 'webgpu',
        dtype: 'q8',
        progress_callback: (progress: unknown) => {
          postToHost({
            id: activeRequestId,
            type: 'progress',
            progress,
          });
        },
      },
    ) as Promise<FeatureExtractionPipeline>;

    extractorPromise.catch(() => {
      extractorPromise = null;
    });
  }

  return extractorPromise;
}

window.addEventListener('message', (event: MessageEvent<NeuralSandboxRequest>) => {
  const request = event.data;
  if (
    event.source !== window.parent
    || request?.source !== 'myalgo-neural-host'
    || request.type !== 'EMBED_TEXTS'
    || typeof request.id !== 'string'
  ) {
    return;
  }

  const texts = Array.isArray(request.texts)
    ? request.texts.filter((value): value is string => typeof value === 'string').slice(0, 384)
    : [];

  void (async () => {
    activeRequestId = request.id!;
    const extractor = await getExtractor();
    const output = await extractor(texts, {
      pooling: 'mean',
      normalize: true,
    });
    const embeddings = output.tolist() as number[][];

    if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
      throw new Error('Neural embedding pipeline returned an unexpected batch shape.');
    }
    if (embeddings.some((vector) => !Array.isArray(vector) || vector.length !== NEURAL_DIMENSIONS)) {
      throw new Error('Neural embedding pipeline returned an unexpected embedding dimension.');
    }

    postToHost({
      id: request.id,
      ok: true,
      modelId: NEURAL_MODEL_ID,
      modelVersion: NEURAL_MODEL_VERSION,
      dimensions: NEURAL_DIMENSIONS,
      backend: 'webgpu-sandbox',
      embeddings,
    });
  })().catch((error) => {
    postToHost({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : 'Neural semantic sandbox failed.',
    });
  }).finally(() => {
    activeRequestId = null;
  });
});

postToHost({ type: 'ready' });
