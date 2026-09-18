import { NextResponse } from 'next/server';
import type { Algorithm, AlgorithmPayload } from '@repo/shared-types';
import { createAlgorithm, listAlgorithms } from '@/lib/data';

export async function GET() {
  const algorithms = await listAlgorithms('demo-user');
  return NextResponse.json(algorithms);
}

export async function POST(request: Request) {
  const payload = (await request.json()) as Partial<AlgorithmPayload>;
  const algorithm = await createAlgorithm('demo-user', {
    name: payload.name ?? 'Work',
    is_active: payload.is_active ?? true,
    goal_text: payload.goal_text ?? null,
    topic_weights: payload.topic_weights ?? [],
    rules: payload.rules ?? [],
  });

  return NextResponse.json(algorithm, { status: 201 });
}
