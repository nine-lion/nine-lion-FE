import { apiFetch, getApiUrl } from './client';

export type LoginRequest = {
  email: string;
  password: string;
};

export type SignupRequest = {
  email: string;
  password: string;
  name: string;
};

export type AuthUser = {
  email: string;
  name: string;
};

export type AuthResponse = {
  status: string;
  user: AuthUser;
};

export type SocialProvider = 'google' | 'kakao';

export function login(data: LoginRequest): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function signup(data: SignupRequest): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/auth/signup', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function getSocialLoginUrl(provider: SocialProvider): string {
  return getApiUrl(`/auth/${provider}/login`);
}

export function getGuestLoginUrl(): string {
  return getApiUrl('/auth/guest/login');
}
