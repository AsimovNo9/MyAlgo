import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const manifestPath = fileURLToPath(new URL('./manifest.json', import.meta.url));

test('MV3 manifest requests only required permissions and production hosts', async () => {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(new Set(manifest.permissions), new Set(['storage', 'identity']));
  assert.equal(manifest.permissions.includes('scripting'), false);
  assert.equal(manifest.host_permissions.includes('https://my-algo-web.vercel.app/*'), true);
  assert.equal(manifest.host_permissions.includes('https://*.youtube.com/*'), true);
  assert.equal(manifest.host_permissions.includes('<all_urls>'), false);
  assert.equal(manifest.content_scripts[0].matches.includes('*://*.youtube.com/*'), true);
});