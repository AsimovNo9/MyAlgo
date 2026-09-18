import type { Algorithm } from '@repo/shared-types';

const sampleAlgorithm: Algorithm = {
  id: 'alg-1',
  name: 'Work',
  is_active: true,
  goal_text: 'Learn AI agents and product design decisions.',
  topic_weights: [
    { topic: 'AI', weight: 90 },
    { topic: 'Productivity', weight: 70 },
    { topic: 'Entertainment', weight: 20 },
  ],
};

export default function AlgorithmsPage() {
  return (
    <main>
      <h1>Algorithms</h1>
      <p>Active mode: {sampleAlgorithm.name}</p>
      <ul>
        {sampleAlgorithm.topic_weights?.map((item) => (
          <li key={item.topic}>
            {item.topic}: {item.weight}
          </li>
        ))}
      </ul>
    </main>
  );
}
