import { NextResponse } from 'next/server';
import type { Rule } from '@repo/shared-types';
import { createRule, listRules } from '@/lib/data';
import { getCurrentUserIdFromServer } from '@/lib/server-user';

export async function GET() {
  const userId = await getCurrentUserIdFromServer();

  if (!userId) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const rules = await listRules(userId);
  return NextResponse.json(rules);
}

export async function POST(request: Request) {
  const userId = await getCurrentUserIdFromServer();

  if (!userId) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const payload = (await request.json()) as Partial<Rule> & { algorithmId?: string };
  const rule = await createRule(userId, payload.algorithmId ?? 'alg-demo-1', {
    type: payload.type ?? 'always_show',
    condition_text: payload.condition_text ?? 'new rule',
  });

  return NextResponse.json(rule, { status: 201 });
}
