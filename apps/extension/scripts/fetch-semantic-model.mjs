import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MODEL_ID = 'mixedbread-ai/mxbai-embed-xsmall-v1';
const REVISION = 'b0561d9a97e6b298da39f0ef3e7d3cf153b1b29a';
const TARGET_ROOT = join(ROOT, 'public', 'models', 'mxbai-embed-xsmall-v1');
const MANIFEST_PATH = join(TARGET_ROOT, '.myalgo-model.json');
const RUNTIME_ROOT = join(ROOT, 'public', 'runtime', 'onnx');
const require = createRequire(import.meta.url);
const ONNX_RUNTIME_ENTRY = require.resolve('onnxruntime-web');
const ONNX_RUNTIME_DIST = dirname(ONNX_RUNTIME_ENTRY);
const RUNTIME_FILES = [
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
];

const FILES = [
  { remote: 'config.json', local: 'config.json', minBytes: 600 },
  { remote: 'tokenizer.json', local: 'tokenizer.json', minBytes: 700_000 },
  { remote: 'tokenizer_config.json', local: 'tokenizer_config.json', minBytes: 1_000 },
  { remote: 'special_tokens_map.json', local: 'special_tokens_map.json', minBytes: 600 },
  { remote: 'vocab.txt', local: 'vocab.txt', minBytes: 200_000 },
  { remote: 'onnx/model_quantized.onnx', local: 'onnx/model_quantized.onnx', minBytes: 24_000_000 },
];

const expectedManifest = {
  modelId: MODEL_ID,
  revision: REVISION,
  files: FILES.map(({ remote, local }) => ({ remote, local })),
};

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

async function isPrepared() {
  try {
    const parsed = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
    if (
      parsed.modelId !== expectedManifest.modelId
      || parsed.revision !== expectedManifest.revision
      || !Array.isArray(parsed.files)
      || parsed.files.length !== FILES.length
    ) return false;

    for (const file of FILES) {
      const info = await stat(join(TARGET_ROOT, file.local));
      if (info.size < file.minBytes) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function downloadFile(file) {
  const target = join(TARGET_ROOT, file.local);
  await mkdir(dirname(target), { recursive: true });

  const url = `https://huggingface.co/${MODEL_ID}/resolve/${REVISION}/${file.remote}?download=true`;
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
    `Unable to package ${file.remote} from pinned model revision: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
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

if (await isPrepared()) {
  console.log(`[MyAlgo] packaged semantic model already present: ${MODEL_ID}@${REVISION}`);
  await packageOnnxRuntime();
  process.exit(0);
}

await rm(TARGET_ROOT, { recursive: true, force: true });
await mkdir(TARGET_ROOT, { recursive: true });

console.log(`[MyAlgo] packaging semantic model ${MODEL_ID}@${REVISION}`);
const files = [];
for (const file of FILES) {
  const downloaded = await downloadFile(file);
  files.push(downloaded);
  console.log(`[MyAlgo] packaged ${downloaded.local} (${downloaded.bytes} bytes)`);
}

await writeFile(
  MANIFEST_PATH,
  JSON.stringify({
    modelId: MODEL_ID,
    revision: REVISION,
    packagedAt: new Date().toISOString(),
    files,
  }, null, 2) + '\n',
);

await packageOnnxRuntime();
console.log('[MyAlgo] semantic model packaging complete');
