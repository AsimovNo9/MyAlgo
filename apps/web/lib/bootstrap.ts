import type { Algorithm } from '@repo/shared-types';
import { createAlgorithm } from './data';

export const defaultAlgorithmSeeds: Partial<Algorithm>[] = [
  {
    name: 'Work',
    is_active: true,
    goal_text: 'Learn AI agents and shipping decisions.',
    topic_weights: [
      { topic: 'AI', weight: 90 },
      { topic: 'Productivity', weight: 75 },
      { topic: 'Business', weight: 60 },
    ],
    rules: [
      { type: 'always_show', condition_text: 'AI agent tutorials' },
      { type: 'never_show', condition_text: 'celebrity gossip' },
    ],
  },
  {
    name: 'Learning',
    is_active: false,
    goal_text: 'Prioritize deep technical learning and tutorials.',
    topic_weights: [
      { topic: 'Tutorial', weight: 95 },
      { topic: 'Engineering', weight: 90 },
      { topic: 'AI', weight: 85 },
      { topic: 'Productivity', weight: 65 },
    ],
    rules: [{ type: 'priority', condition_text: 'how to' }],
  },
  {
    name: 'Relax',
    is_active: false,
    goal_text: 'Keep the feed lighter and less work-focused.',
    topic_weights: [
      { topic: 'Entertainment', weight: 80 },
      { topic: 'Productivity', weight: 30 },
      { topic: 'AI', weight: 20 },
    ],
    rules: [{ type: 'never_show', condition_text: 'work tutorial' }],
  },
];

export const defaultAlgorithmSeed = defaultAlgorithmSeeds[0];

export async function createDefaultAlgorithmForUser(userId: string) {
  const existingAlgorithms = await (await import('./data')).listAlgorithms(userId);
  if (existingAlgorithms.length > 0) {
    return existingAlgorithms[0];
  }

  return createAlgorithm(userId, defaultAlgorithmSeed);
}

export async function ensureDefaultAlgorithmsForUser(userId: string) {
  const existingAlgorithms = await (await import('./data')).listAlgorithms(userId);
  const existingNames = new Set(existingAlgorithms.map((algorithm) => algorithm.name.toLowerCase()));

  for (const seed of defaultAlgorithmSeeds) {
    if (!seed.name || existingNames.has(seed.name.toLowerCase())) {
      continue;
    }

    await createAlgorithm(userId, seed);
  }

  return (await import('./data')).listAlgorithms(userId);
}
