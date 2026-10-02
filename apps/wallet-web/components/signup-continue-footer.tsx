'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

const AUTO_LEAVE_SECONDS = 3;

interface SignupContinueFooterProps {
  onLeave: () => void;
  label: string;
}

/**
 * 계좌 등록 완료 화면은 «끝났다»처럼 보이고 은행 접수 문자까지 와서, 가입을 마저 하는 버튼을
 * 누르지 않고 떠나기 쉽다. 그러면 계좌만 등록되고 가입은 없는 상태가 남는다. 그래서 잠깐 보여 준 뒤
 * 스스로 가입 화면으로 돌아간다. 계좌 정보를 더 보려는 고객은 멈출 수 있어야 한다(자동 이동은 끌 수 있어야 한다).
 */
export function SignupContinueFooter({ onLeave, label }: SignupContinueFooterProps) {
  const [remaining, setRemaining] = useState(AUTO_LEAVE_SECONDS);
  const [stayed, setStayed] = useState(false);
  const leftRef = useRef(false);

  const leave = () => {
    if (leftRef.current) return;
    leftRef.current = true;
    onLeave();
  };

  useEffect(() => {
    if (stayed) return;
    // 백그라운드 탭은 타이머가 느려진다 — 남은 시간은 틱 수가 아니라 마감 시각에서 계산한다.
    const deadline = Date.now() + AUTO_LEAVE_SECONDS * 1000;
    const timer = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) {
        window.clearInterval(timer);
        leave();
      }
    }, 250);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stayed]);

  return (
    <footer className="shrink-0 px-5 pb-[calc(1rem_+_env(safe-area-inset-bottom))] pt-3">
      <Button onClick={leave} className="h-14 w-full rounded-2xl text-[16px] font-semibold">
        {label}
      </Button>
      <p className="mt-3 text-center text-[13px] break-keep text-muted-foreground" aria-live="polite">
        {stayed ? (
          '자동 이동을 멈췄어요. 위 버튼을 눌러 가입을 마무리해주세요.'
        ) : (
          <>
            {/* 숫자는 매초 바뀐다 — 화면낭독기가 초마다 다시 읽지 않게 숫자만 낭독에서 뺀다. */}
            <span aria-hidden="true">{remaining}초 뒤 </span>
            <span className="sr-only">잠시 뒤 </span>
            가입 화면으로 이동해요 ·{' '}
            <button
              type="button"
              onClick={() => setStayed(true)}
              className="underline underline-offset-2 hover:text-foreground"
            >
              이 화면에 머무르기
            </button>
          </>
        )}
      </p>
    </footer>
  );
}
