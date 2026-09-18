import type { Rule, TopicWeight } from '@repo/shared-types';

export function scoreContent(items: { title: string; channel_name?: string | null }[], weights: TopicWeight[], rules: Rule[]) {
  return items.map((item) => {
    const base = weights.reduce((sum, weight) => {
      const match = item.title.toLowerCase().includes(weight.topic.toLowerCase()) || item.channel_name?.toLowerCase().includes(weight.topic.toLowerCase());
      return match ? sum + weight.weight : sum;
    }, 0);

    const hasPriorityRule = rules.some((rule) => rule.type === 'priority' && item.title.toLowerCase().includes(rule.condition_text.toLowerCase()));
    const visible = !rules.some((rule) => rule.type === 'never_show' && item.title.toLowerCase().includes(rule.condition_text.toLowerCase()));

    return {
      title: item.title,
      channel_name: item.channel_name,
      score: base + (hasPriorityRule ? 15 : 0),
      visible,
    };
  });
}
