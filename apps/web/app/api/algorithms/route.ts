import { NextResponse } from 'next/server';
import type { Algorithm, AlgorithmPayload } from '@repo/shared-types';
import { createAlgorithm, listAlgorithms } from '@/lib/data';
import { getCurrentUserIdFromServer } from '@/lib/server-user';

export async function GET() {
  const userId = await getCurrentUserIdFromServer();

  if (!userId) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const algorithms = await listAlgorithms(userId);

  if (algorithms.length === 0) {
    const { createDefaultAlgorithmForUser } = await import('@/lib/bootstrap');
    await createDefaultAlgorithmForUser(userId);
    return NextResponse.json(await listAlgorithms(userId));
  }

  return NextResponse.json(algorithms);
}

export async function POST(request: Request) {
  const userId = await getCurrentUserIdFromServer();

  if (!userId) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const payload = (await request.json()) as Partial<AlgorithmPayload>;
  const algorithm = await createAlgorithm(userId, {
    name: payload.name ?? 'Work',
    is_active: payload.is_active ?? true,
    goal_text: payload.goal_text ?? null,
    topic_weights: payload.topic_weights ?? [],
    rules: payload.rules ?? [],
  });

  return NextResponse.json(algorithm, { status: 201 });
}
