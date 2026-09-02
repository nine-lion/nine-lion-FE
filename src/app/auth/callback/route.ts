import { createHash } from 'node:crypto';
import { type NextRequest, NextResponse } from 'next/server';
import { ACCOUNT_KEY_COOKIE, AUTH_STATUS_COOKIE } from '@/lib/auth';

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

  // No user profile is returned by the social callback, only an opaque
  // token — hash it so each social session gets its own data bucket
  // without exposing any part of the token in a JS-readable cookie.
  const accountKey = `social-${createHash('sha256').update(accessToken).digest('hex').slice(0, 16)}`;
  response.cookies.set(ACCOUNT_KEY_COOKIE, accountKey, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });

  return response;
}
