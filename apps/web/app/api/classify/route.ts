import { NextResponse } from 'next/server';
import type { ClassifyRequest, ClassifyResponse } from '@repo/shared-types';
import { classifyContent } from '@/lib/classifier';

export async function POST(request: Request) {
  const body = (await request.json()) as ClassifyRequest;
  const classification = await classifyContent(body.title);

  const response: ClassifyResponse = {
    id: body.contentItemId,
    topics: classification.topics,
    content_type: classification.content_type,
    language: classification.language,
    format: classification.format,
    quality_score: classification.quality_score,
    reasoning: classification.reasoning,
  };

  return NextResponse.json(response, { status: 201 });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    note: 'Classification uses deterministic topic detection and optionally asks Anthropic to disambiguate titles with no strong local topic match when ANTHROPIC_API_KEY is configured.',
  });
}
