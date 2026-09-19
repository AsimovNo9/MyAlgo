import type { Algorithm, Rule, TopicWeight } from '@repo/shared-types';
import { createSupabaseServerClient } from './supabase/server';

const demoAlgorithms: Algorithm[] = [
  {
    id: 'alg-demo-1',
    name: 'Work',
    is_active: true,
    goal_text: 'Learn AI agents and shipping decisions.',
    topic_weights: [
      { topic: 'AI', weight: 90 },
      { topic: 'Productivity', weight: 75 },
      { topic: 'Business', weight: 60 },
    ],
    rules: [
      { id: 'rule-demo-1', type: 'always_show', condition_text: 'AI agent tutorials' },
      { id: 'rule-demo-2', type: 'never_show', condition_text: 'celebrity gossip' },
    ],
  },
];

const demoRules: Rule[] = [
  { id: 'rule-demo-1', type: 'always_show', condition_text: 'AI agent tutorials' },
  { id: 'rule-demo-2', type: 'never_show', condition_text: 'celebrity gossip' },
  { id: 'rule-demo-3', type: 'priority', condition_text: 'engineering breakdowns' },
];

export async function listAlgorithms(userId: string): Promise<Algorithm[]> {
  const client = await createSupabaseServerClient();
  if (!client) {
    return demoAlgorithms;
  }

  const { data, error } = await client
    .from('algorithms')
    .select('*, topic_weights(*), rules(*), algorithm_intent_profiles(semantic_terms)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error || !data) {
    console.error('Failed to fetch algorithms', error);
    return demoAlgorithms;
  }

  return data.map((row) => {
    const profileRows = Array.isArray(row.algorithm_intent_profiles)
      ? (row.algorithm_intent_profiles as Array<{ semantic_terms?: string[] | null }>)
      : [];
    const semanticTerms = profileRows.flatMap((profile: { semantic_terms?: string[] | null }) =>
      Array.isArray(profile?.semantic_terms) ? profile.semantic_terms : [],
    );

    return {
      id: row.id,
      name: row.name,
      is_active: row.is_active,
      goal_text: row.goal_text,
      created_at: row.created_at,
      topic_weights: (row.topic_weights ?? []) as TopicWeight[],
      rules: (row.rules ?? []) as Rule[],
      semantic_terms: semanticTerms,
    };
  });
}

export async function createAlgorithm(userId: string, input: Partial<Algorithm>): Promise<Algorithm> {
  const client = await createSupabaseServerClient();
  if (!client) {
    return {
      id: 'alg-demo-created',
      name: input.name ?? 'Work',
      is_active: input.is_active ?? true,
      goal_text: input.goal_text ?? null,
      topic_weights: input.topic_weights ?? [],
      rules: input.rules ?? [],
    };
  }

  const { data, error } = await client
    .from('algorithms')
    .insert({
      user_id: userId,
      name: input.name ?? 'Work',
      is_active: input.is_active ?? false,
      goal_text: input.goal_text ?? null,
    })
    .select()
    .single();

  if (error || !data) {
    console.error('Failed to create algorithm', error);
    return {
      id: 'alg-demo-created',
      name: input.name ?? 'Work',
      is_active: input.is_active ?? true,
      goal_text: input.goal_text ?? null,
      topic_weights: input.topic_weights ?? [],
      rules: input.rules ?? [],
    };
  }

  const topicWeights = input.topic_weights ?? [];
  if (topicWeights.length > 0) {
    const weightRows = topicWeights.map((item) => ({
      algorithm_id: data.id,
      topic: item.topic,
      weight: item.weight,
    }));

    const { error: weightsError } = await client.from('topic_weights').insert(weightRows);
    if (weightsError) {
      console.error('Failed to create topic weights', weightsError);
    }
  }

  const rules = input.rules ?? [];
  if (rules.length > 0) {
    const ruleRows = rules.map((rule) => ({
      algorithm_id: data.id,
      type: rule.type,
      condition_text: rule.condition_text,
    }));

    const { error: rulesError } = await client.from('rules').insert(ruleRows);
    if (rulesError) {
      console.error('Failed to create rules', rulesError);
    }
  }

  return {
    id: data.id,
    name: data.name,
    is_active: data.is_active,
    goal_text: data.goal_text,
    created_at: data.created_at,
    topic_weights: topicWeights,
    rules,
  };
}

export async function deleteAlgorithm(userId: string, algorithmId: string): Promise<{ ok: boolean; error?: string }> {
  const client = await createSupabaseServerClient();
  if (!client) {
    return { ok: false, error: 'Supabase is not configured.' };
  }

  const { data: algorithms, error: listError } = await client
    .from('algorithms')
    .select('id, is_active')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (listError) {
    console.error('Failed to check algorithms before deletion', listError);
    return { ok: false, error: 'Unable to load algorithms.' };
  }

  const target = algorithms?.find((algorithm) => algorithm.id === algorithmId);
  if (!target) {
    return { ok: false, error: 'Algorithm not found.' };
  }

  if ((algorithms ?? []).length <= 1) {
    return { ok: false, error: 'Keep at least one algorithm.' };
  }

  const { error: deleteError } = await client
    .from('algorithms')
    .delete()
    .eq('id', algorithmId)
    .eq('user_id', userId);

  if (deleteError) {
    console.error('Failed to delete algorithm', deleteError);
    return { ok: false, error: 'Unable to delete algorithm.' };
  }

  if (target.is_active) {
    const replacement = algorithms?.find((algorithm) => algorithm.id !== algorithmId);
    if (replacement) {
      const { error: activateError } = await client
        .from('algorithms')
        .update({ is_active: true })
        .eq('id', replacement.id)
        .eq('user_id', userId);

      if (activateError) {
        console.error('Failed to activate replacement algorithm', activateError);
      }
    }
  }

  return { ok: true };
}

export async function listRules(userId: string, algorithmId?: string): Promise<Rule[]> {
  const client = await createSupabaseServerClient();
  if (!client) {
    return demoRules;
  }

  let algorithmQuery = client.from('algorithms').select('id').eq('user_id', userId);
  if (algorithmId) {
    algorithmQuery = algorithmQuery.eq('id', algorithmId);
  }

  const { data: algorithmRows, error: algorithmError } = await algorithmQuery;
  if (algorithmError || !algorithmRows) {
    console.error('Failed to fetch algorithm ids for rules', algorithmError);
    return demoRules;
  }

  const algorithmIds = algorithmRows.map((row) => row.id);
  if (algorithmIds.length === 0) {
    return [];
  }

  const { data, error } = await client
    .from('rules')
    .select('*')
    .in('algorithm_id', algorithmIds)
    .order('created_at', { ascending: false });

  if (error || !data) {
    console.error('Failed to fetch rules', error);
    return demoRules;
  }

  return data as Rule[];
}

export async function createRule(userId: string, algorithmId: string, input: Partial<Rule>): Promise<Rule> {
  const client = await createSupabaseServerClient();
  if (!client) {
    return {
      id: 'rule-demo-created',
      type: input.type ?? 'always_show',
      condition_text: input.condition_text ?? 'new rule',
    };
  }

  const { data, error } = await client
    .from('rules')
    .insert({
      algorithm_id: algorithmId,
      type: input.type ?? 'always_show',
      condition_text: input.condition_text ?? 'new rule',
    })
    .select()
    .single();

  if (error || !data) {
    console.error('Failed to create rule', error);
    return {
      id: 'rule-demo-created',
      type: input.type ?? 'always_show',
      condition_text: input.condition_text ?? 'new rule',
    };
  }

  return data as Rule;
}
