import test from 'node:test';
import assert from 'node:assert/strict';

import { getProviderConfig } from './provider.ts';

test('google provider includes YouTube readonly scope', () => {
  const config = getProviderConfig('google');

  assert.ok(config);
  assert.match(config.scopes, /youtube\.readonly/);
});
