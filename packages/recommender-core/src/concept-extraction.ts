import { semanticInputHash } from './semantic-reranking.ts';

export const CONCEPT_EXTRACTION_MODEL_ID = 'Xenova/flan-t5-small';
export const CONCEPT_EXTRACTION_MODEL_VERSION = 'transformersjs-local-q8-v1';

export type ConceptExtractionCandidate = {
  external_id: string;
  title: string;
  description?: string | null;
  topics?: string[];
  content_type?: string | null;
  channel_name?: string | null;
};

const normalize = (value: string): string => value.replace(/\s+/g, ' ').trim();

export function buildConceptExtractionPrompt(
  candidate: ConceptExtractionCandidate,
): string {
  const title = normalize(candidate.title).slice(0, 220);
  const description = normalize(candidate.description ?? '').slice(0, 700);
  const rawTopics = (candidate.topics ?? [])
    .map(normalize)
    .filter(Boolean)
    .slice(0, 12)
    .join(', ');
  const category = normalize(candidate.content_type ?? '').slice(0, 80);

  return [
    'Extract 1 to 4 concise reusable semantic topics from this YouTube video metadata.',
    'Prefer named subjects, fields, activities, genres, or durable interests.',
    'Avoid title fragments, generic words, creator names, and phrases like video, guide, review, full gameplay, episode, reaction.',
    'Return only a comma-separated list of topic phrases with no explanation.',
    `Title: ${title}`,
    description ? `Description: ${description}` : '',
    rawTopics ? `Keywords: ${rawTopics}` : '',
    category ? `Category: ${category}` : '',
  ].filter(Boolean).join('\n');
}

const GENERIC = new Set([
  'content', 'entertainment', 'episode', 'full gameplay', 'gameplay video',
  'guide', 'music video', 'reaction', 'review', 'shorts', 'tutorial', 'video',
]);

const cleanConcept = (value: string): string => normalize(
  value
    .replace(/^[-*•\d.)\s]+/, '')
    .replace(/^topics?\s*:\s*/i, '')
    .replace(/^concepts?\s*:\s*/i, '')
    .replace(/^["'\`]+|["'\`]+$/g, ''),
);

export function parseConceptExtractionOutput(
  value: string,
  maxConcepts = 4,
): string[] {
  const normalized = value
    .replace(/\r/g, '\n')
    .replace(/\n+/g, ',')
    .replace(/[;|]+/g, ',');
  const seen = new Set<string>();
  const concepts: string[] = [];

  for (const raw of normalized.split(',')) {
    const concept = cleanConcept(raw);
    if (!concept || concept.length < 3 || concept.length > 56) continue;
    const words = concept.split(/\s+/).filter(Boolean);
    if (words.length === 0 || words.length > 6) continue;
    const key = concept.toLocaleLowerCase('en-US');
    if (GENERIC.has(key)) continue;
    if (/^(title|description|keywords?|category)\b/i.test(concept)) continue;
    if (/^https?:\/\//i.test(concept)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    concepts.push(concept);
    if (concepts.length >= Math.max(1, maxConcepts)) break;
  }

  return concepts;
}

export function conceptExtractionInputHash(
  candidate: ConceptExtractionCandidate,
): string {
  return semanticInputHash(buildConceptExtractionPrompt(candidate));
}
