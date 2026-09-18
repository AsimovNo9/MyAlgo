import { NextResponse } from 'next/server';
import type { Rule } from '@repo/shared-types';
import { createRule, listRules } from '@/lib/data';

export async function GET() {
  const rules = await listRules('demo-user');
  return NextResponse.json(rules);
}

export async function POST(request: Request) {
  const payload = (await request.json()) as Partial<Rule> & { algorithmId?: string };
  const rule = await createRule('demo-user', payload.algorithmId ?? 'alg-demo-1', {
    type: payload.type ?? 'always_show',
    condition_text: payload.condition_text ?? 'new rule',
  });

  return NextResponse.json(rule, { status: 201 });
}
