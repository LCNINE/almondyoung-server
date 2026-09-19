'use client';

import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { ChevronLeft } from 'lucide-react';
import { CmsSignaturePad } from '@/components/cms-signature-pad';

function Preview() {
  const before = useSearchParams().get('before') === '1';
  return (
    <div
      className={
        before
          ? 'mx-auto flex h-dvh w-full max-w-md flex-col overflow-hidden bg-background'
          : 'mx-auto flex min-h-dvh w-full max-w-md flex-col bg-background'
      }
    >
      <div className="fixed top-2 right-2 z-50 rounded bg-black px-2 py-1 text-xs text-white">
        {before ? '수정 전' : '수정 후'}
      </div>
      <header className="relative flex h-14 shrink-0 items-center px-2">
        <button type="button" className="rounded-full p-2 text-foreground/70" aria-label="이전 단계로">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <Image
          src="/images/almond-logo-black.png"
          alt="아몬드영"
          width={200}
          height={150}
          className="absolute left-1/2 h-5 w-auto -translate-x-1/2"
        />
      </header>

      <div className="animate-in fade-in slide-in-from-right-5 flex min-h-0 flex-1 flex-col px-5 pt-6 pb-[calc(1rem_+_env(safe-area-inset-bottom))] duration-300 ease-out">
        <h1 className="text-[24px] font-bold leading-[1.35] tracking-tight text-foreground">
          마지막으로 서명해주세요
        </h1>
        <p className="mt-2.5 text-[14px] leading-relaxed text-muted-foreground">
          자동이체 동의서에 들어가는 서명이에요. 은행 심사에 그대로 제출됩니다.
        </p>
        <div className="mt-7 flex min-h-0 flex-1 flex-col">
          <CmsSignaturePad onComplete={() => alert('제출 버튼 눌림')} />
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Preview />
    </Suspense>
  );
}
