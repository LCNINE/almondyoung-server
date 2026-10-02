'use client';

import { Info } from 'lucide-react';
import { SignupContinueFooter } from '@/components/signup-continue-footer';
import { buildReturnUrl, leaveToReturnUrl } from '@/lib/return-url';

interface PendingSignupResumeProps {
  returnUrl: string;
  billingMethodId: string;
  displayName: string | null;
}

/**
 * 멤버십 가입 도중인데 이미 은행 심사 중인 계좌가 있는 고객. 새로 등록하면 같은 사람이 심사를 한 번 더
 * 걸게 되므로, 그 계좌로 가입을 이어 간다. 스토어프론트는 돌아온 billingMethodId 로 바로 가입한다.
 */
export function PendingSignupResume({ returnUrl, billingMethodId, displayName }: PendingSignupResumeProps) {
  const goBack = () => leaveToReturnUrl(buildReturnUrl(returnUrl, { cardChanged: '1', billingMethodId }));
  const registerAnother = `/billing-change?returnUrl=${encodeURIComponent(returnUrl)}&register=1`;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-background">
      <div className="flex-1 px-6 pt-16">
        <h1 className="text-[22px] font-bold tracking-tight text-foreground">이미 등록한 계좌가 있어요</h1>
        <p className="mt-2 text-[15px] leading-relaxed break-keep text-muted-foreground">
          은행 심사가 진행 중인 계좌로 멤버십 가입을 이어 갈게요. 계좌를 다시 등록할 필요는 없어요.
        </p>

        <dl className="mt-8">
          <div className="flex items-center justify-between border-b border-border py-4">
            <dt className="text-[14px] text-muted-foreground">계좌</dt>
            <dd className="text-[15px] font-bold tracking-tight text-foreground">{displayName ?? '자동이체 계좌'}</dd>
          </div>
          <div className="flex items-center justify-between border-b border-border py-4">
            <dt className="text-[14px] text-muted-foreground">은행 심사</dt>
            <dd className="text-[15px] font-bold tracking-tight text-foreground">진행 중</dd>
          </div>
        </dl>

        <div className="mt-7 flex items-start gap-2.5 rounded-xl bg-muted p-4">
          <Info className="mt-0.5 size-4 shrink-0 text-primary" />
          <p className="text-[13px] leading-relaxed break-keep text-foreground">
            결제는 심사 승인과 함께 자동으로 출금돼요. 다른 계좌로 받고 싶으면{' '}
            <a href={registerAnother} className="font-semibold underline underline-offset-2">
              새 계좌로 등록하기
            </a>
            를 눌러주세요.
          </p>
        </div>
      </div>

      <SignupContinueFooter onLeave={goBack} label="이 계좌로 가입 마무리하기" />
    </div>
  );
}
