import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const manifestPath = fileURLToPath(new URL('./manifest.json', import.meta.url));

test('MV3 manifest requests only storage, offscreen worker support, and YouTube host access', async () => {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(new Set(manifest.permissions), new Set(['storage', 'offscreen']));
  assert.equal(manifest.permissions.includes('scripting'), false);
  assert.equal(manifest.permissions.includes('identity'), false);
  assert.equal(manifest.permissions.includes('identity.email'), false);
  assert.equal(Object.hasOwn(manifest, 'oauth2'), false);
  assert.deepEqual(new Set(manifest.host_permissions), new Set([
    'https://*.youtube.com/*',
  ]));
  assert.equal(manifest.host_permissions.includes('https://*.youtube.com/*'), true);
  assert.equal(manifest.host_permissions.includes('<all_urls>'), false);
  assert.equal(Object.hasOwn(manifest, 'optional_host_permissions'), false);
  assert.deepEqual(manifest.sandbox?.pages, ['neural-sandbox.html']);
  assert.equal(
    manifest.content_security_policy?.extension_pages,
    "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
  );
  assert.match(manifest.content_security_policy?.sandbox ?? '', /script-src 'self' blob:/);
  assert.equal((manifest.content_security_policy?.extension_pages ?? '').includes('blob:'), false);
  assert.equal(manifest.content_scripts[0].matches.includes('https://*.youtube.com/*'), true);
  assert.deepEqual(manifest.web_accessible_resources, [{
    resources: ['assets/*.js'],
    matches: ['https://*.youtube.com/*'],
  }]);
  assert.equal(manifest.web_accessible_resources[0].matches.includes('<all_urls>'), false);
});