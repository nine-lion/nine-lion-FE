import { type NextRequest, NextResponse } from 'next/server';
import { AUTH_STATUS_COOKIE } from '@/lib/auth';

const ACCESS_TOKEN_COOKIE = 'access_token';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const accessToken = searchParams.get('access_token');

  if (!accessToken) {
    const loginUrl = new URL('/login', origin);
    loginUrl.searchParams.set('error', 'social_login_failed');
    return NextResponse.redirect(loginUrl);
  }

  const response = NextResponse.redirect(new URL('/', origin));

  response.cookies.set(ACCESS_TOKEN_COOKIE, accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });

  response.cookies.set(AUTH_STATUS_COOKIE, '1', {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });

  return response;
}
