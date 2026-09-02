export const AUTH_STATUS_COOKIE = 'is_authenticated';

export function isAuthenticated(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie
    .split('; ')
    .some((entry) => entry === `${AUTH_STATUS_COOKIE}=1`);
}

export function markAuthenticated() {
  document.cookie = `${AUTH_STATUS_COOKIE}=1; path=/; max-age=${60 * 60 * 24 * 7}`;
}
