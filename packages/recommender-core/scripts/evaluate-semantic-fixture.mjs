import { readFile } from 'node:fs/promises';

import { runSemanticModeEvaluationFixture } from '../src/replay-evaluation.ts';

const fixtureUrl = process.argv[2]
  ? new URL(process.argv[2], `file://${process.cwd()}/`)
  : new URL('../test/fixtures/semantic-mode-eval-v1.json', import.meta.url);

const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8'));
const report = await runSemanticModeEvaluationFixture(fixture);

const summary = {
  fixture: report.fixtureName,
  fixtureVersion: report.fixtureVersion,
  provider: report.provider,
  metrics: report.metrics,
};

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
