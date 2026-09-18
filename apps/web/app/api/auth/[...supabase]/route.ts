import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    ok: true,
    note: 'Supabase auth hook is configured for the next integration step. Add the app URL and provider settings to enable the OAuth flow.',
  });
}

export async function POST() {
  return NextResponse.json({
    ok: true,
    note: 'Supabase auth hook is configured for the next integration step. Add the app URL and provider settings to enable the OAuth flow.',
  });
}
