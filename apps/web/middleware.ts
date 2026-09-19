import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

function isAllowedExtensionOrigin(origin: string | null) {
  return Boolean(origin && (
    /^chrome-extension:\/\/[a-p]{32}$/i.test(origin)
    || origin.startsWith('http://localhost:')
  ));
}

export function middleware(request: NextRequest) {
  const origin = request.headers.get('origin');
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  });

  if (isAllowedExtensionOrigin(origin)) {
    headers.set('Access-Control-Allow-Origin', origin!);
  }

  if (request.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers });
  }

  const response = NextResponse.next();
  headers.forEach((value, key) => response.headers.set(key, value));
  return response;
}

export const config = {
  matcher: '/api/:path*',
};