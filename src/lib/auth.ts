export const AUTH_STATUS_COOKIE = 'is_authenticated';
export const ACCOUNT_KEY_COOKIE = 'account_key';
export const GUEST_ACCOUNT_KEY = 'guest';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  for (const entry of document.cookie.split('; ')) {
    const [key, ...rest] = entry.split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function isAuthenticated(): boolean {
  return readCookie(AUTH_STATUS_COOKIE) === '1';
}

export function getAccountKey(): string {
  return readCookie(ACCOUNT_KEY_COOKIE) || GUEST_ACCOUNT_KEY;
}

export function getServerAccountKey(): string {
  return GUEST_ACCOUNT_KEY;
}

export function markAuthenticated(accountKey: string) {
  document.cookie = `${AUTH_STATUS_COOKIE}=1; path=/; max-age=${COOKIE_MAX_AGE}`;
  document.cookie = `${ACCOUNT_KEY_COOKIE}=${encodeURIComponent(accountKey)}; path=/; max-age=${COOKIE_MAX_AGE}`;
}
