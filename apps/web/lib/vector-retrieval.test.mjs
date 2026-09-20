import test from 'node:test';
import assert from 'node:assert/strict';

import { retrieveSimilarContent } from './vector-retrieval.ts';

test('retrieves bounded versioned vector matches through the database RPC', async () => {
  let request;
  const matches = await retrieveSimilarContent({
    rpc: async (name, args) => {
      request = { name, args };
      return { data: [{ content_item_id: 'content-1', similarity: 0.91, model_version: 'embed-v1' }], error: null };
    },
  }, [0.1, 0.2], { threshold: 0.8, limit: 120, modelVersion: 'embed-v1' });

  assert.equal(request.name, 'match_content_embeddings');
  assert.equal(request.args.match_threshold, 0.8);
  assert.equal(request.args.match_count, 100);
  assert.deepEqual(matches, [{ content_item_id: 'content-1', similarity: 0.91, model_version: 'embed-v1' }]);
});

test('returns an empty fallback when vector retrieval is unavailable', async () => {
  assert.deepEqual(await retrieveSimilarContent(null, [0.1]), []);
  assert.deepEqual(await retrieveSimilarContent({ rpc: async () => ({ data: null, error: new Error('unavailable') }) }, [0.1]), []);
});