import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RUNTIME_ROOT = join(ROOT, 'public', 'runtime', 'onnx');
const require = createRequire(import.meta.url);
const ONNX_RUNTIME_ENTRY = require.resolve('onnxruntime-web');
const ONNX_RUNTIME_DIST = dirname(ONNX_RUNTIME_ENTRY);
const RUNTIME_FILES = [
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
];

const MODELS = [
  {
    modelId: 'mixedbread-ai/mxbai-embed-xsmall-v1',
    revision: 'b0561d9a97e6b298da39f0ef3e7d3cf153b1b29a',
    localName: 'mxbai-embed-xsmall-v1',
    files: [
      { remote: 'config.json', local: 'config.json', minBytes: 600 },
      { remote: 'tokenizer.json', local: 'tokenizer.json', minBytes: 700_000 },
      { remote: 'tokenizer_config.json', local: 'tokenizer_config.json', minBytes: 1_000 },
      { remote: 'special_tokens_map.json', local: 'special_tokens_map.json', minBytes: 600 },
      { remote: 'vocab.txt', local: 'vocab.txt', minBytes: 200_000 },
      { remote: 'onnx/model_quantized.onnx', local: 'onnx/model_quantized.onnx', minBytes: 24_000_000 },
    ],
  },
  {
    modelId: 'Xenova/flan-t5-small',
    revision: '311454e83bc784267fd7eef5940ee854144abbec',
    localName: 'flan-t5-small',
    files: [
      { remote: 'config.json', local: 'config.json', minBytes: 1_000 },
      { remote: 'generation_config.json', local: 'generation_config.json', minBytes: 100 },
      { remote: 'tokenizer.json', local: 'tokenizer.json', minBytes: 1_000_000 },
      { remote: 'tokenizer_config.json', local: 'tokenizer_config.json', minBytes: 1_000 },
      { remote: 'special_tokens_map.json', local: 'special_tokens_map.json', minBytes: 100 },
      { remote: 'spiece.model', local: 'spiece.model', minBytes: 700_000 },
      { remote: 'onnx/encoder_model_quantized.onnx', local: 'onnx/encoder_model_quantized.onnx', minBytes: 30_000_000 },
      { remote: 'onnx/decoder_model_merged_quantized.onnx', local: 'onnx/decoder_model_merged_quantized.onnx', minBytes: 50_000_000 },
    ],
  },
];

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

const modelTargetRoot = (model) => join(ROOT, 'public', 'models', model.localName);
const modelManifestPath = (model) => join(modelTargetRoot(model), '.myalgo-model.json');

async function isPrepared(model) {
  const targetRoot = modelTargetRoot(model);
  try {
    const parsed = JSON.parse(await readFile(modelManifestPath(model), 'utf8'));
    if (
      parsed.modelId !== model.modelId
      || parsed.revision !== model.revision
      || !Array.isArray(parsed.files)
      || parsed.files.length !== model.files.length
    ) return false;

    for (const file of model.files) {
      const info = await stat(join(targetRoot, file.local));
      if (info.size < file.minBytes) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function downloadFile(model, file) {
  const targetRoot = modelTargetRoot(model);
  const target = join(targetRoot, file.local);
  await mkdir(dirname(target), { recursive: true });

  const url = `https://huggingface.co/${model.modelId}/resolve/${model.revision}/${file.remote}?download=true`;
  let lastError = null;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        headers: { 'User-Agent': 'MyAlgo-build/1.0' },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength < file.minBytes) {
        throw new Error(`downloaded ${buffer.byteLength} bytes; expected at least ${file.minBytes}`);
      }

      const temporary = `${target}.tmp`;
      await writeFile(temporary, buffer);
      await rename(temporary, target);
      return {
        remote: file.remote,
        local: file.local,
        bytes: buffer.byteLength,
        sha256: sha256(buffer),
      };
    } catch (error) {
      lastError = error;
      if (attempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
      }
    }
  }

  throw new Error(
    `Unable to package ${file.remote} from ${model.modelId}@${model.revision}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

async function packageModel(model) {
  const targetRoot = modelTargetRoot(model);
  if (await isPrepared(model)) {
    console.log(`[MyAlgo] packaged model already present: ${model.modelId}@${model.revision}`);
    return;
  }

  await rm(targetRoot, { recursive: true, force: true });
  await mkdir(targetRoot, { recursive: true });

  console.log(`[MyAlgo] packaging model ${model.modelId}@${model.revision}`);
  const files = [];
  for (const file of model.files) {
    const downloaded = await downloadFile(model, file);
    files.push(downloaded);
    console.log(`[MyAlgo] packaged ${model.localName}/${downloaded.local} (${downloaded.bytes} bytes)`);
  }

  await writeFile(
    modelManifestPath(model),
    JSON.stringify({
      modelId: model.modelId,
      revision: model.revision,
      packagedAt: new Date().toISOString(),
      files,
    }, null, 2) + '\n',
  );
}

async function packageOnnxRuntime() {
  await rm(RUNTIME_ROOT, { recursive: true, force: true });
  await mkdir(RUNTIME_ROOT, { recursive: true });
  for (const file of RUNTIME_FILES) {
    const source = join(ONNX_RUNTIME_DIST, file);
    const target = join(RUNTIME_ROOT, file);
    await copyFile(source, target);
    const info = await stat(target);
    console.log(`[MyAlgo] packaged ONNX runtime ${file} (${info.size} bytes)`);
  }
}

for (const model of MODELS) {
  await packageModel(model);
}
await packageOnnxRuntime();
console.log('[MyAlgo] local semantic model packaging complete');
