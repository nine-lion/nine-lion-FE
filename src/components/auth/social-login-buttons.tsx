import Image from 'next/image';
import Link from 'next/link';
import { getSocialLoginUrl } from '@/lib/api/auth';

const buttonClassName =
  'inline-flex size-10 cursor-pointer items-center justify-center overflow-hidden rounded-full bg-secondary transition-transform hover:bg-secondary/80 active:scale-95';

export function SocialLoginButtons() {
  return (
    <div className="mt-8 flex justify-center gap-8">
      <Link
        href={getSocialLoginUrl('google')}
        className={buttonClassName}
        aria-label="구글 로그인"
      >
        <Image
          src="/images/google-login.png"
          alt=""
          width={40}
          height={40}
          className="pointer-events-none"
        />
      </Link>
      <a
        href={getSocialLoginUrl('kakao')}
        className={buttonClassName}
        aria-label="카카오 로그인"
      >
        <Image
          src="/images/kakao-login.png"
          alt=""
          width={40}
          height={40}
          className="pointer-events-none"
        />
      </a>
    </div>
  );
}
