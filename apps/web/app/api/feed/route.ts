import { NextResponse } from 'next/server';
import type { FeedResponse } from '@repo/shared-types';

export async function GET() {
  const payload: FeedResponse = {
    generatedAt: new Date().toISOString(),
    algorithmId: 'alg-1',
    items: [
      {
        id: 'content-1',
        external_id: 'abc123',
        title: 'AI agents workflow demo',
        channel_name: 'Build with AI',
        score: 92,
        visible: true,
        reason: 'Strong match for AI topic weight and tutorial rule.',
        matched_topics: ['AI', 'tutorial'],
      },
      {
        id: 'content-2',
        external_id: 'def456',
        title: 'Productivity system overview',
        channel_name: 'Deep Work Daily',
        score: 81,
        visible: true,
        matched_topics: ['Productivity'],
      },
    ],
  };

  return NextResponse.json(payload);
}
