import { NextRequest, NextResponse } from 'next/server';
import { AUTH_STATUS_COOKIE } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL('/', request.url));

  response.cookies.delete('access_token');
  response.cookies.delete(AUTH_STATUS_COOKIE);

  return response;
}
