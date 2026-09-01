import type { Metadata } from 'next';
import { LoginForm } from './login-form';

export const metadata: Metadata = {
  title: '로그인',
  description:
    'Study Mate에 로그인하고 PDF로 만든 맞춤 학습을 시작하세요.',
};

export default function LoginPage() {
  return <LoginForm />;
}
