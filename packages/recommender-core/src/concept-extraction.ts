import { semanticInputHash } from './semantic-reranking.ts';

export const CONCEPT_EXTRACTION_MODEL_ID = 'onnx-community/SmolLM2-135M-Instruct-ONNX-MHA';
export const CONCEPT_EXTRACTION_MODEL_VERSION = 'transformersjs-local-q4f16-v1';
export const CONCEPT_EXTRACTION_PIPELINE_VERSION = 'prompt-parser-v2';

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
    'Task: label this video with 1 to 4 reusable interest concepts.',
    'Output exactly one comma-separated line. No explanation, no sentence, no heading.',
    'Use concise nouns or noun phrases. Prefer the underlying subject, activity, genre, field, franchise, or durable interest.',
    'Do not output generic production words such as video, review, guide, gameplay, episode, reaction, metadata, channel, or creator.',
    'Do not repeat a long title phrase when a shorter concept captures it.',
    'Examples:',
    'Title: Silent Hill Townfall Full Gameplay Ending',
    'Keywords: Silent Hill Townfall, gameplay, ending',
    'Output: Silent Hill, survival horror',
    'Title: 3 Hours Chill Lofi Hip Hop Mix for Studying',
    'Keywords: chill lofi beats, study lofi, lofi hip hop mix',
    'Output: lo-fi music, hip hop, study music',
    'Now label this item:',
    `Title: ${title}`,
    description ? `Description: ${description}` : '',
    rawTopics ? `Keywords: ${rawTopics}` : '',
    category ? `Category: ${category}` : '',
    'Output:',
  ].filter(Boolean).join('\n');
}

const GENERIC = new Set([
  'a.k.a.', 'content', 'creator', 'entertainment', 'episode', 'filming',
  'full gameplay', 'gameplay video', 'guide', 'metadata', 'music video',
  'reaction', 'review', 'seconds', 'shorts', 'tutorial', 'video', 'video video',
  'youtube', 'youtube video', 'youtube video metadata',
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
    if (/^(title|description|keywords?|category|output|topics?|concepts?)\b/i.test(concept)) continue;
    if (/^(list|describe|identify|extract|return|write|give|provide|name)\b/i.test(concept)) continue;
    if (/\b(?:youtube|wikipedia|metadata)\b/i.test(concept)) continue;
    if (/^https?:\/\//i.test(concept)) continue;
    if (!/[\p{L}\p{N}]/u.test(concept)) continue;
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
