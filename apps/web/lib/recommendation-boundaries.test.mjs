import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));

test('feed and page ranking routes do not trigger retrieval or model work', () => {
  const routes = [
    path.join(directory, '../app/api/feed/route.ts'),
    path.join(directory, '../app/api/rank/route.ts'),
  ];
  const forbiddenImport = /from ['"].*(youtube|classifier|embedding|retriev|anthropic|openai).*['"]/i;

  for (const route of routes) {
    const source = fs.readFileSync(route, 'utf8');
    assert.equal(forbiddenImport.test(source), false, `${path.basename(path.dirname(route))} must not import retrieval or model modules`);
  }
});