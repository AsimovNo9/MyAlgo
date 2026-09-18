import type { Algorithm } from '@repo/shared-types';
import { createAlgorithm } from './data';

export const defaultAlgorithmSeed: Partial<Algorithm> = {
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
};

export async function createDefaultAlgorithmForUser(userId: string) {
  const existingAlgorithms = await (await import('./data')).listAlgorithms(userId);
  if (existingAlgorithms.length > 0) {
    return existingAlgorithms[0];
  }

  return createAlgorithm(userId, defaultAlgorithmSeed);
}
