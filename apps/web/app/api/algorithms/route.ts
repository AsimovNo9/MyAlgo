import { NextResponse } from 'next/server';
import type { Algorithm, AlgorithmPayload } from '@repo/shared-types';
import { createAlgorithm, deleteAlgorithm } from '@/lib/data';
import { getCurrentUserIdFromServer } from '@/lib/server-user';

export async function GET() {
  const userId = await getCurrentUserIdFromServer();

  if (!userId) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const { ensureDefaultAlgorithmsForUser } = await import('@/lib/bootstrap');
  return NextResponse.json(await ensureDefaultAlgorithmsForUser(userId));
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

export async function DELETE(request: Request) {
  const userId = await getCurrentUserIdFromServer();

  if (!userId) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const payload = (await request.json()) as { id?: string };
  const algorithmId = payload.id?.trim();
  if (!algorithmId) {
    return NextResponse.json({ error: 'Algorithm id is required.' }, { status: 400 });
  }

  const result = await deleteAlgorithm(userId, algorithmId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.error === 'Algorithm not found.' ? 404 : 400 });
  }

  return NextResponse.json({ ok: true, deletedId: algorithmId });
}
