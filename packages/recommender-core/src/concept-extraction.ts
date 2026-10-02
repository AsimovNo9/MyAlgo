import { semanticInputHash } from './semantic-reranking.ts';

export const CONCEPT_EXTRACTION_MODEL_ID = 'Xenova/nli-deberta-v3-xsmall';
export const CONCEPT_EXTRACTION_MODEL_VERSION = 'transformersjs-local-q8-wasm-v1';
export const CONCEPT_EXTRACTION_PIPELINE_VERSION = 'zero-shot-verifier-v2';

export type ConceptExtractionCandidate = {
  external_id: string;
  title: string;
  description?: string | null;
  topics?: string[];
  content_type?: string | null;
  channel_name?: string | null;
  semantic_transcript?: string | null;
};

export type ConceptVerificationInput = {
  text: string;
  labels: string[];
};

const normalize = (value: string): string => value.replace(/\s+/g, ' ').trim();

const GENERIC = new Set([
  'content', 'creator', 'entertainment', 'episode', 'filming', 'full gameplay',
  'gameplay', 'gameplay video', 'guide', 'metadata', 'music video', 'reaction',
  'review', 'seconds', 'shorts', 'tutorial', 'video', 'video games',
  'youtube', 'youtube video',
]);

const cleanCandidateLabel = (value: string): string => normalize(
  value
    .replace(/^[-*•\d.)\s]+/, '')
    .replace(/^["'\`]+|["'\`]+$/g, ''),
);

export function buildConceptVerificationText(
  candidate: ConceptExtractionCandidate,
): string {
  const title = normalize(candidate.title).slice(0, 220);
  const description = normalize(candidate.description ?? '').slice(0, 700);
  const category = normalize(candidate.content_type ?? '').slice(0, 80);
  const transcript = normalize(candidate.semantic_transcript ?? '').slice(0, 900);

  return [
    title,
    description,
    category ? `Category: ${category}` : '',
    transcript ? `Transcript excerpt: ${transcript}` : '',
  ].filter(Boolean).join('\n');
}

export function buildConceptCandidateLabels(
  candidate: ConceptExtractionCandidate,
  maxLabels = 12,
): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];

  for (const raw of candidate.topics ?? []) {
    const label = cleanCandidateLabel(raw);
    if (!label || label.length < 3 || label.length > 56) continue;
    const words = label.split(/\s+/).filter(Boolean);
    if (words.length === 0 || words.length > 6) continue;

    const key = label.toLocaleLowerCase('en-US');
    if (GENERIC.has(key)) continue;
    if (/^(title|description|keywords?|category|output|topics?|concepts?)\b/i.test(label)) continue;
    if (/^(list|describe|identify|extract|return|write|give|provide|name)\b/i.test(label)) continue;
    if (/\b(?:youtube|wikipedia|metadata)\b/i.test(label)) continue;
    if (/^https?:\/\//i.test(label)) continue;
    if (!/[\p{L}\p{N}]/u.test(label)) continue;
    if (seen.has(key)) continue;

    seen.add(key);
    labels.push(label);
    if (labels.length >= Math.max(1, maxLabels)) break;
  }

  return labels;
}

export function buildConceptVerificationInput(
  candidate: ConceptExtractionCandidate,
): ConceptVerificationInput {
  return {
    text: buildConceptVerificationText(candidate),
    labels: buildConceptCandidateLabels(candidate),
  };
}

export function selectVerifiedConcepts(
  labels: readonly string[],
  scores: readonly number[],
  options: {
    minimumScore?: number;
    maxConcepts?: number;
  } = {},
): string[] {
  const minimumScore = Math.max(0, Math.min(1, options.minimumScore ?? 0.58));
  const maxConcepts = Math.max(1, Math.floor(options.maxConcepts ?? 4));

  return labels
    .map((label, index) => ({
      label,
      score: Number(scores[index] ?? Number.NEGATIVE_INFINITY),
    }))
    .filter((entry) => Number.isFinite(entry.score) && entry.score >= minimumScore)
    .sort((left, right) => (
      right.score - left.score
      || left.label.localeCompare(right.label)
    ))
    .slice(0, maxConcepts)
    .map((entry) => entry.label);
}

export function conceptExtractionInputHash(
  candidate: ConceptExtractionCandidate,
): string {
  const input = buildConceptVerificationInput(candidate);
  return semanticInputHash(JSON.stringify(input));
}
