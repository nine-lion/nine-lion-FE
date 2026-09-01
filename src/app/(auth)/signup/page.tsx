import type { Metadata } from 'next';
import { SignupForm } from '@/components/auth/signup-form';

export const metadata: Metadata = {
  title: '회원가입',
  description:
    'Study Mate에 가입하고 PDF로 만든 맞춤 학습을 시작하세요.',
};

export default function SignupPage() {
  return <SignupForm />;
}
