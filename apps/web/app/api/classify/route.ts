import { NextResponse } from 'next/server';
import type { ClassifyRequest, ClassifyResponse } from '@repo/shared-types';

export async function POST(request: Request) {
  const body = (await request.json()) as ClassifyRequest;

  const response: ClassifyResponse = {
    id: body.contentItemId,
    topics: ['AI', 'tutorial'],
    content_type: 'tutorial',
    quality_score: 88,
    reasoning: `Classification stub for ${body.title}.`,
  };

  return NextResponse.json(response, { status: 201 });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    note: 'Classification endpoint ready for future async job wiring.',
  });
}
