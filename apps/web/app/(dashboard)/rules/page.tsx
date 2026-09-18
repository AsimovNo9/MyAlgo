import type { Rule } from '@repo/shared-types';

const sampleRules: Rule[] = [
  { id: 'r1', type: 'always_show', condition_text: 'tutorials about AI agents' },
  { id: 'r2', type: 'never_show', condition_text: 'celebrity gossip' },
  { id: 'r3', type: 'priority', condition_text: 'engineering breakdowns' },
];

export default function RulesPage() {
  return (
    <main>
      <h1>Rules</h1>
      <ul>
        {sampleRules.map((rule) => (
          <li key={rule.id}>
            {rule.type}: {rule.condition_text}
          </li>
        ))}
      </ul>
    </main>
  );
}
