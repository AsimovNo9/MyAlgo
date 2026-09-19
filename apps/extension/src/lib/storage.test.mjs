import test from 'node:test';
import assert from 'node:assert/strict';

const storage = new Map();
const removedKeys = [];
globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        return Object.fromEntries(keys.filter((key) => storage.has(key)).map((key) => [key, storage.get(key)]));
      },
      async set(values) {
        Object.entries(values).forEach(([key, value]) => storage.set(key, value));
      },
      async remove(keys) {
        removedKeys.push(...keys);
        keys.forEach((key) => storage.delete(key));
      },
    },
  },
};

const { getStorage, removeStorage, setStorage } = await import('./storage.ts');

test('storage helpers remove session data without affecting unrelated preferences', async () => {
  await setStorage('personal-algorithm-feed-cache', [{ external_id: 'video-1' }]);
  await setStorage('personal-algorithm-mode', 'Work');

  await removeStorage(['personal-algorithm-feed-cache']);

  assert.deepEqual(await getStorage('personal-algorithm-feed-cache', []), []);
  assert.equal(await getStorage('personal-algorithm-mode', null), 'Work');
  assert.deepEqual(removedKeys, ['personal-algorithm-feed-cache']);
});