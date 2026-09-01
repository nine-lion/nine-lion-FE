'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { login } from '@/lib/api/auth';
import { ApiError } from '@/lib/api/client';
import { SocialLoginButtons } from '@/components/auth/social-login-buttons';

const fieldClassName =
  'h-12 w-full rounded-sm border border-input bg-surface px-4 text-body text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-primary';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loginMutation = useMutation({
    mutationFn: login,
    onSuccess: () => {
      router.push('/');
      router.refresh();
    },
    onError: (error) => {
      setErrorMessage(
        error instanceof ApiError ? error.message : '로그인에 실패했습니다.',
      );
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    loginMutation.mutate({ email, password });
  }

  return (
    <div className="rounded-2xl bg-surface p-8 shadow-[0_10px_40px_-12px_rgb(17_24_39/0.14)] sm:p-10">
      <h2 className="text-title text-foreground">로그인</h2>

      <form className="mt-6 flex flex-col gap-3" onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor="email">
          이메일
        </label>
        <input
          id="email"
          type="email"
          name="email"
          autoComplete="email"
          placeholder="이메일"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={fieldClassName}
          required
        />
        <label className="sr-only" htmlFor="password">
          비밀번호
        </label>
        <input
          id="password"
          type="password"
          name="password"
          autoComplete="current-password"
          placeholder="비밀번호"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={fieldClassName}
          required
        />
        {errorMessage && (
          <p className="text-caption text-danger">{errorMessage}</p>
        )}
        <button
          type="submit"
          disabled={loginMutation.isPending}
          className="mt-1 flex h-12 w-full items-center justify-center rounded-sm bg-primary text-body font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loginMutation.isPending ? '로그인 중...' : '이메일 로그인'}
        </button>
      </form>

      <div className="my-5 flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-caption text-muted-foreground">또는 계속하기</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <SocialLoginButtons />

      <p className="mt-6 text-center text-caption text-muted">
        계정이 없나요?{' '}
        <Link
          href="/signup"
          className="font-medium text-primary hover:text-primary-hover"
        >
          회원가입
        </Link>
      </p>
    </div>
  );
}
