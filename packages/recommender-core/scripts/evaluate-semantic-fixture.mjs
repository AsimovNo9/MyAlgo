import { readFile } from 'node:fs/promises';

import { buildCanonicalSemanticConcepts } from '../src/canonical-semantic.ts';
import {
  evaluateCanonicalAssignments,
  evaluateCanonicalSemanticAggregation,
  runSemanticModeEvaluationFixture,
} from '../src/replay-evaluation.ts';

const semanticFixtureUrl = process.argv[2]
  ? new URL(process.argv[2], `file://${process.cwd()}/`)
  : new URL('../test/fixtures/semantic-mode-eval-v1.json', import.meta.url);

const semanticFixture = JSON.parse(await readFile(semanticFixtureUrl, 'utf8'));
const semanticReport = await runSemanticModeEvaluationFixture(semanticFixture);

const summary = {
  semantic: {
    fixture: semanticReport.fixtureName,
    fixtureVersion: semanticReport.fixtureVersion,
    provider: semanticReport.provider,
    metrics: semanticReport.metrics,
  },
};

if (!process.argv[2]) {
  const canonicalFixtureUrl = new URL(
    '../test/fixtures/canonical-semantic-eval-v1.json',
    import.meta.url,
  );
  const canonicalFixture = JSON.parse(await readFile(canonicalFixtureUrl, 'utf8'));
  const embeddingsByNodeId = new Map(
    Object.entries(canonicalFixture.embeddingsByNodeId ?? {}),
  );
  const canonical = buildCanonicalSemanticConcepts(canonicalFixture.state, {
    embeddingsByNodeId,
    embeddingModelVersion: canonicalFixture.embeddingModelVersion ?? null,
  });
  const assignmentMetrics = evaluateCanonicalAssignments(
    canonicalFixture.expectedAssignments ?? [],
    canonical.assignmentByNodeId,
  );
  const aggregationMetrics = evaluateCanonicalSemanticAggregation(
    canonicalFixture.aggregationSamples ?? [],
  );

  if (assignmentMetrics.accuracy !== 1) {
    throw new Error(
      `Canonical semantic fixture accuracy ${assignmentMetrics.accuracy}; mismatches: ${JSON.stringify(assignmentMetrics.mismatches)}`,
    );
  }
  if (aggregationMetrics.semanticContributionMassReduction <= 0) {
    throw new Error('Canonical semantic fixture did not reduce duplicate contribution mass.');
  }
  if (aggregationMetrics.displaySaturationAfterRate > aggregationMetrics.displaySaturationBeforeRate) {
    throw new Error('Canonical semantic fixture increased display-score saturation.');
  }

  summary.canonical = {
    fixture: canonicalFixture.name,
    fixtureVersion: canonicalFixture.fixtureVersion,
    pipeline: canonical.marker,
    diagnostics: canonical.diagnostics,
    assignmentMetrics,
    aggregationMetrics,
  };
}

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
