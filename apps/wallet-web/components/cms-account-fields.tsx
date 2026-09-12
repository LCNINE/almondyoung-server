'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertCircle, ChevronLeft, Info, Loader2, Pencil } from 'lucide-react';
import { CMS_BANKS, formatAccountDigits, getAccountDigits, getBankName } from '@/lib/cms-banks';
import { AccountHolderType } from '@/components/payer-number-field';
import { isValidPayerNumber } from '@/lib/payer-number';
import { redirectToWalletLogin } from '@/lib/auth-expired';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { STOREFRONT_ORIGIN } from '@/lib/return-url';

export interface CmsAccountDetails {
  paymentCompany: string;
  payerName: string;
  paymentNumber: string;
  phone: string;
  holderType: AccountHolderType;
  payerNumber: string;
}

export const emptyCmsAccountDetails: CmsAccountDetails = {
  paymentCompany: '',
  payerName: '',
  paymentNumber: '',
  phone: '',
  holderType: 'personal',
  payerNumber: '',
};

/**
 * 효성이 준 코드로 «어느 칸이» 틀렸는지 특정한다. 폼 전체에 한 덩어리로 띄우면 고객이
 * 메시지에서 칸까지 눈으로 되짚어 올라가야 한다 — 틀린 값을 물어본 화면으로 되돌린다.
 */
const STEP_BY_PROVIDER_CODE: Record<string, 'account' | 'payer'> = {
  '1001': 'account',
  '2001': 'payer',
};

type Step = 'bank' | 'account' | 'payer' | 'confirm';

const STEP_ORDER: Step[] = ['bank', 'account', 'payer', 'confirm'];

/** 휴대폰 번호(01X-XXXX-XXXX). 자동이체 안내 문자가 여기로 가므로 유선번호는 받지 않는다. */
const PHONE_PATTERN = /^01[016789]\d{7,8}$/;

function formatPhone(digits: string): string {
  if (digits.length <= 3) return digits;
  const mid = digits.startsWith('010') ? 7 : 6;
  if (digits.length <= mid) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, mid)}-${digits.slice(mid)}`;
}

/**
 * 키보드를 뺀 «실제로 보이는» 높이. iOS Safari 는 키보드가 올라와도 레이아웃 뷰포트를 줄이지
 * 않아서(layout.tsx 의 interactiveWidget 힌트를 읽지 않는다) 하단 버튼이 키보드 뒤로 숨는다.
 *
 * 버튼을 sticky 로 띄우는 방법은 못 쓴다 — sticky 는 «스크롤이 있을 때만» 작동하는데, 내용이
 * 한 화면에 들어차는 단계에선 스크롤이 없어서 그대로 제자리에 남는다. 대신 컨테이너 높이를
 * 이 값으로 맞춘다. 그러면 flex 흐름상 마지막인 버튼이 저절로 키보드 위로 올라온다.
 */
function useViewportHeight(): { height?: number; keyboardOpen: boolean } {
  const [height, setHeight] = useState<number>();
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      setHeight(vv.height);
      setKeyboardOpen(window.innerHeight - vv.height > 120);
    };
    update();
    vv.addEventListener('resize', update);
    return () => vv.removeEventListener('resize', update);
  }, []);
  return { height, keyboardOpen };
}

/** 은행이 확인해 준 조합. 같은 값을 다시 물으면 건당 100원이 또 나가므로 재사용한다. */
export interface CmsVerifiedAccount {
  paymentCompany: string;
  paymentNumber: string;
  payerNumber: string;
  payerName: string;
  attemptId: string;
}

interface CmsAccountFieldsProps {
  value: CmsAccountDetails;
  onChange: (next: CmsAccountDetails) => void;
  /** 모든 단계를 통과했다 — 부모가 동의 단계로 넘긴다. */
  onComplete: () => void;
  /**
   * 확인 결과는 부모가 들고 있어야 한다. 동의 단계로 넘어가면 이 컴포넌트가 unmount 되는데,
   * 캐시가 여기 있으면 뒤로 돌아왔을 때 같은 계좌를 다시 유료 조회한다.
   */
  verified: CmsVerifiedAccount | null;
  onVerifiedChange: (next: CmsVerifiedAccount | null) => void;
}

/**
 * 계좌 등록 입력을 «한 화면에 하나씩» 묻는다. 은행 → 계좌번호 → 예금주 정보 →
 * 은행 조회 → 확인. 마지막 입력이 끝나는 자리에서 바로 조회가 돌기 때문에,
 * 고객은 «등록했는데 이틀 뒤 거절» 대신 그 자리에서 결과를 본다.
 */
export function CmsAccountFields({ value, onChange, onComplete, verified, onVerifiedChange }: CmsAccountFieldsProps) {
  const [step, setStep] = useState<Step>('bank');
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');
  const { height: viewportHeight, keyboardOpen } = useViewportHeight();
  const payerNumberRef = useRef<HTMLInputElement>(null);
  const paymentNumberRef = useRef<HTMLInputElement>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 직전에 «거절당한» 조합. 같은 값으로 또 유료 조회를 태우기 전에 한 번 되묻는다. */
  const [lastRejected, setLastRejected] = useState<{
    paymentCompany: string;
    paymentNumber: string;
    payerNumber: string;
    field?: 'account' | 'payer';
  } | null>(null);
  const [confirmRetryOpen, setConfirmRetryOpen] = useState(false);
  /** 연락처는 타이핑 중에 빨간 줄을 띄우면 방해다 — 칸을 벗어났거나 길이를 다 채웠을 때만 본다. */
  const [phoneTouched, setPhoneTouched] = useState(false);

  const patch = (next: Partial<CmsAccountDetails>) => onChange({ ...value, ...next });

  const valueRef = useRef(value);
  valueRef.current = value;

  /**
   * 같은 조합을 다시 묻는 동안에는 같은 시도 ID 를 쓴다. 매 호출 새 키를 보내면
   * 타임아웃 뒤 재시도가 건당 유료 호출을 그대로 한 번 더 태운다.
   */
  const attempt = useRef<{ combo: string; id: string } | null>(null);
  const attemptIdFor = (combo: string) => {
    if (attempt.current?.combo !== combo) attempt.current = { combo, id: crypto.randomUUID() };
    return attempt.current.id;
  };
  /**
   * 장애(UNAVAILABLE)·상한(429)까지 같은 키로 두면 그 응답이 그대로 replay 된다 —
   * 「잠시 후 다시」라고 안내해 놓고 영영 같은 답만 돌아온다. 다시 물어야 하는 결과는
   * 키를 버려 다음 시도가 실제 호출이 되게 한다.
   */
  const forgetAttempt = () => {
    attempt.current = null;
  };

  const go = (next: Step) => {
    setDir(STEP_ORDER.indexOf(next) < STEP_ORDER.indexOf(step) ? 'back' : 'fwd');
    setStep(next);
  };

  const runCheck = async () => {
    // 응답이 오는 사이 값이 바뀌었으면 그 응답은 «다른 조합»의 결과다. 그대로 반영하면
    // 사용자가 방금 고친 값을 덮고 엉뚱한 계좌를 확인 화면에 보여준다.
    const asked = {
      paymentCompany: value.paymentCompany,
      paymentNumber: value.paymentNumber,
      payerNumber: value.payerNumber,
      attemptId: attemptIdFor(`${value.paymentCompany}:${value.paymentNumber}:${value.payerNumber}`),
    };
    const isStale = () =>
      asked.paymentCompany !== valueRef.current.paymentCompany ||
      asked.paymentNumber !== valueRef.current.paymentNumber ||
      asked.payerNumber !== valueRef.current.payerNumber;

    setChecking(true);
    setError(null);
    try {
      const res = await fetch('/api/billing/cms-check-account', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentCompany: value.paymentCompany,
          paymentNumber: value.paymentNumber,
          payerNumber: value.payerNumber,
          attemptId: asked.attemptId,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        verified?: boolean;
        payerName?: string | null;
        reason?: 'MISMATCH' | 'UNAVAILABLE' | null;
        message?: string | null;
        providerCode?: string | null;
      };

      // 세션이 끊긴 건 「계좌가 틀렸다」가 아니다 — 백엔드 원문을 칸 밑에 띄우지 말고
      // 다른 화면들과 같이 로그인으로 보내 토큰을 되살린다.
      if (res.status === 401) {
        redirectToWalletLogin();
        return;
      }
      // 응답을 «어떻게든» 쓰기 전에 본다 — 값이 바뀐 뒤 도착한 실패까지 현재 조합의
      // 오류로 띄우거나, 지금 조합의 시도 ID 를 남의 응답 때문에 버리게 된다.
      if (isStale()) return;
      if (!res.ok) {
        // 호출 상한(429)·장애. 확인이 안 된 채로 다음 화면에 보내면 고객은 등록된 줄 안다.
        forgetAttempt();
        setError(data.error ?? '지금은 확인할 수 없어요. 잠시 후 다시 시도해주세요.');
        return;
      }
      if (data.verified) {
        // 이름을 못 받았다고 직전 계좌의 예금주명을 물려주면 «다른 계좌 + 옛 이름» 으로
        // 등록된다. 비워서 확인 화면에서 직접 채우게 한다.
        const payerName = data.payerName ?? '';
        patch({ payerName });
        onVerifiedChange({
          paymentCompany: asked.paymentCompany,
          paymentNumber: asked.paymentNumber,
          payerNumber: asked.payerNumber,
          payerName,
          attemptId: asked.attemptId,
        });
        go('confirm');
        return;
      }

      // 「틀렸다」는 확답(MISMATCH)은 같은 조합이면 결과도 같으니 키를 유지한다.
      // 장애는 다음에 달라질 수 있다.
      if (data.reason !== 'MISMATCH') forgetAttempt();

      const message = data.message ?? '계좌를 확인하지 못했어요.';
      const back = data.providerCode ? STEP_BY_PROVIDER_CODE[data.providerCode] : undefined;
      setError(message);
      if (data.reason === 'MISMATCH') {
        setLastRejected({
          paymentCompany: value.paymentCompany,
          paymentNumber: value.paymentNumber,
          payerNumber: value.payerNumber,
          field: back,
        });
        if (back) go(back);
      }
      // 불일치도 장애도 여기 머문다 — 은행이 확인해준 계좌만 다음으로 넘어간다.
    } catch {
      setError('확인 중 문제가 생겼어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setChecking(false);
    }
  };

  /** 직전에 거절당한 것과 «완전히 같은» 조합인가. 그대로 다시 물으면 결과도 같다. */
  const isSameAsRejected =
    lastRejected !== null &&
    lastRejected.paymentCompany === value.paymentCompany &&
    lastRejected.paymentNumber === value.paymentNumber &&
    lastRejected.payerNumber === value.payerNumber;

  /** 이미 확인에 성공한 그 조합 그대로인가. 그러면 은행에 다시 물을 이유가 없다. */
  const isAlreadyVerified =
    verified !== null &&
    verified.paymentCompany === value.paymentCompany &&
    verified.paymentNumber === value.paymentNumber &&
    verified.payerNumber === value.payerNumber;

  const requestCheck = () => {
    if (isAlreadyVerified) {
      // 조회는 통과했는데 이름을 못 받아온 경우가 있다. 그때 사용자가 직접 채운 이름을
      // 빈 문자열로 덮으면 required 에 걸려 다시 막힌다.
      if (verified.payerName) patch({ payerName: verified.payerName });
      go('confirm');
      return;
    }
    if (isSameAsRejected) {
      setConfirmRetryOpen(true);
      return;
    }
    void runCheck();
  };

  const back = () => {
    setError(null);
    if (step === 'account') go('bank');
    if (step === 'payer') go('account');
    if (step === 'confirm') go('payer');
  };

  // 입력은 account·payer 단계에 걸쳐 계속 마운트돼 있어 autoFocus 가 두 번째부터는 안 먹는다.
  // 1001/2001 로 칸을 되돌렸을 때 키보드 사용자가 그 칸에서 이어 칠 수 있어야 한다.
  useEffect(() => {
    if (step === 'account') paymentNumberRef.current?.focus();
    if (step === 'payer') payerNumberRef.current?.focus();
  }, [step]);

  const stepAnim =
    dir === 'fwd'
      ? 'animate-in fade-in slide-in-from-right-5 duration-300 ease-out'
      : 'animate-in fade-in slide-in-from-left-5 duration-300 ease-out';
  const progress = ((STEP_ORDER.indexOf(step) + 1) / STEP_ORDER.length) * 100;

  const accountDigits = getAccountDigits(value.paymentCompany);
  const accountLengthOk =
    value.paymentNumber.length >= accountDigits.min && value.paymentNumber.length <= accountDigits.max;

  const isPersonal = value.holderType === 'personal';
  const phoneInvalid = value.phone.length > 0 && !PHONE_PATTERN.test(value.phone);
  const showPhoneError = phoneInvalid && (phoneTouched || value.phone.length >= 11);

  const canProceed =
    step === 'account'
      ? value.paymentNumber.length > 0
      : step === 'payer'
        ? isValidPayerNumber(value.payerNumber) && !checking
        : step === 'confirm'
          ? Boolean(value.payerName) && PHONE_PATTERN.test(value.phone)
          : false;

  // 엔터(모바일 키보드의 완료·이동)로도 그 단계의 주 버튼과 같은 일이 일어난다.
  const proceed = () => {
    if (!canProceed) return;
    if (step === 'account') {
      if (!accountLengthOk) {
        setError(`${getBankName(value.paymentCompany)} 계좌번호는 ${formatAccountDigits(value.paymentCompany)}예요.`);
        return;
      }
      go('payer');
    } else if (step === 'payer') requestCheck();
    else if (step === 'confirm') onComplete();
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        proceed();
      }}
      className="flex min-h-dvh flex-col overflow-hidden bg-background"
      // minHeight 로는 안 된다 — 내용이 그보다 크면 컨테이너가 그냥 커지고, 문서가 레이아웃
      // 뷰포트(iOS 는 키보드가 떠도 안 줄어든다)보다 작아 스크롤조차 없어 sticky 도 안 먹는다.
      // 키보드가 떠 있는 동안은 보이는 높이로 «고정»하고, 넘치는 본문은 아래에서 스크롤시킨다.
      style={keyboardOpen && viewportHeight ? { height: `${viewportHeight}px`, minHeight: 0 } : undefined}
    >
      <header className="relative flex h-14 shrink-0 items-center px-2">
        {step !== 'bank' && (
          <button
            type="button"
            onClick={back}
            className="rounded-full p-2 text-foreground/70 transition-colors hover:bg-muted"
            aria-label="이전 단계로"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        {/* 돌아갈 곳은 «왔던 화면»이다. 입력 도중 이탈이라 confirm 으로 한 번 묻는다. */}
        <a
          href={STOREFRONT_ORIGIN}
          onClick={(e) => {
            if (step !== 'bank' && !window.confirm('계좌 등록을 그만두시겠어요? 입력한 내용은 저장되지 않습니다.')) {
              e.preventDefault();
            }
          }}
          className="absolute left-1/2 -translate-x-1/2"
          aria-label="아몬드영 홈으로"
        >
          <Image src="/images/almond-logo-black.png" alt="아몬드영" width={200} height={150} className="h-5 w-auto" />
        </a>
      </header>

      <div className="h-[2px] shrink-0 bg-border/50">
        <div
          className="h-full rounded-r-full bg-primary/90 transition-[width] duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {step === 'bank' && (
        <StepBody title="어느 은행 계좌인가요?" className={stepAnim}>
          <div className="-mx-1 grid grid-cols-3 gap-2">
            {CMS_BANKS.map((bank) => (
              <button
                key={bank.code}
                type="button"
                onClick={() => {
                  // 계좌번호·실명번호는 «그 은행의» 값이다. 은행만 갈아끼우면 이전 은행의
                  // 값이 새 은행 것으로 보인다. 반대로 같은 은행을 다시 고른 것뿐이라면
                  // 아무것도 버리지 않는다 — 확인 캐시를 비우면 같은 계좌를 또 유료 조회한다.
                  setError(null);
                  if (bank.code !== value.paymentCompany) {
                    onVerifiedChange(null);
                    setLastRejected(null);
                    patch({ paymentCompany: bank.code, paymentNumber: '', payerNumber: '', payerName: '' });
                  }
                  go('account');
                }}
                className={`flex h-[72px] flex-col items-center justify-center rounded-2xl border text-[13px] font-medium transition-all duration-150 active:scale-[0.96] ${
                  value.paymentCompany === bank.code
                    ? 'border-primary text-primary'
                    : 'border-transparent bg-muted/60 text-foreground hover:bg-muted'
                }`}
              >
                {bank.name}
              </button>
            ))}
          </div>
        </StepBody>
      )}

      {(step === 'account' || step === 'payer') && (
        <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-10 pt-6 ${stepAnim}`}>
          <h1 className="text-[24px] font-bold leading-[1.35] tracking-tight text-foreground">
            계좌 정보를 입력해주세요
          </h1>

          {/* toss.tech/article/toss-signup-process — 필드를 «역순»으로 쌓는다. 새로 물어보는 칸이
              위에 오고 이미 채운 칸이 아래로 밀린다. 키보드가 하단을 덮어도 지금 입력할 칸은
              항상 보인다. 순서가 거꾸로인 건 사용자가 알아채지 못한다(집중하는 칸만 본다). */}
          <div className="mt-7 space-y-7">
            {step === 'payer' && (
              <div className="animate-in fade-in slide-in-from-top-3 duration-300 ease-out">
                <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
                  {(['personal', 'business'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => {
                        setError(null);
                        patch({ holderType: type, payerNumber: '' });
                        // 명의를 고른 다음 할 일은 번호 입력이다 — 손으로 한 번 더 탭하게 두지 않는다.
                        payerNumberRef.current?.focus();
                      }}
                      className={`h-10 rounded-lg text-[14px] font-semibold transition-all duration-200 ${
                        value.holderType === type ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
                      }`}
                    >
                      {type === 'personal' ? '개인 명의' : '사업자 명의'}
                    </button>
                  ))}
                </div>
                <p className="mt-5 mb-1 text-[13px] text-muted-foreground">
                  {isPersonal ? '예금주 생년월일 6자리' : '사업자등록번호 10자리'}
                </p>
                <StackedInput
                  ariaLabel={isPersonal ? '예금주 생년월일 6자리' : '사업자등록번호 10자리'}
                  describedBy={error ? 'payer-number-error' : undefined}
                  disabled={checking}
                  inputRef={payerNumberRef}
                  value={value.payerNumber}
                  onChange={(next) => {
                    setError(null);
                    patch({ payerNumber: next.slice(0, isPersonal ? 6 : 10) });
                  }}
                  placeholder={isPersonal ? '예) 900101' : '예) 1234567890'}
                  invalid={Boolean(error)}
                />
                <FieldError message={error} id="payer-number-error" />
                <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
                  {isPersonal
                    ? '주민등록번호 앞 6자리예요. 계좌를 만들 때 등록한 번호와 같아야 합니다.'
                    : '‘-’ 없이 10자리. 계좌가 사업자(상호) 명의일 때만 선택하세요.'}
                </p>
              </div>
            )}

            <StackedField label="계좌번호">
              <StackedInput
                inputRef={paymentNumberRef}
                ariaLabel="계좌번호"
                describedBy={step === 'account' && error ? 'payment-number-error' : undefined}
                disabled={checking}
                value={value.paymentNumber}
                onChange={(next) => {
                  setError(null);
                  patch({ paymentNumber: next.slice(0, accountDigits.max) });
                }}
                placeholder="- 없이 숫자만 입력"
                invalid={step === 'account' && Boolean(error)}
              />
              {step === 'account' && <FieldError message={error} id="payment-number-error" />}
            </StackedField>

            <StackedField label="은행">
              <button
                type="button"
                onClick={() => go('bank')}
                className="flex h-14 w-full items-center justify-between border-b border-border text-left text-[22px] font-semibold tracking-tight text-foreground"
              >
                {getBankName(value.paymentCompany)}
                <Pencil className="size-4 text-muted-foreground" />
              </button>
            </StackedField>
          </div>
        </div>
      )}

      {step === 'confirm' && (
        <StepBody title="이 계좌가 맞나요?" className={stepAnim}>
          <div className="animate-in fade-in zoom-in-95 flex items-center justify-between gap-4 rounded-2xl border border-border/60 bg-muted/30 p-5 duration-300 ease-out">
            <div className="min-w-0">
              {value.payerName && (
                <p className="truncate text-[20px] font-bold tracking-tight text-foreground">{value.payerName}</p>
              )}
              <p className={`text-[14px] tabular-nums text-muted-foreground ${value.payerName ? 'mt-1' : ''}`}>
                {getBankName(value.paymentCompany)} · {value.paymentNumber}
              </p>
            </div>
            <Image
              src="/images/badge-account-verified.png"
              alt="은행에서 확인된 계좌"
              width={160}
              height={160}
              className="animate-in zoom-in-50 fill-mode-both size-[60px] shrink-0 -rotate-6 rounded-full delay-200 duration-500"
            />
          </div>

          {/* 계좌는 확인됐는데 이름만 못 받아온 경우. 잠그면 빈 값 + required 로 등록이 막힌다. */}
          {!value.payerName && (
            <div className="space-y-2">
              <label htmlFor="payerName" className="text-[13px] font-medium text-foreground">
                예금주명
              </label>
              <Input
                id="payerName"
                value={value.payerName}
                onChange={(e) => patch({ payerName: e.target.value })}
                placeholder="계좌의 실제 예금주"
                maxLength={15}
                className="h-12"
              />
            </div>
          )}

          <div className="pt-7">
            <p className="mb-2 text-[17px] font-bold tracking-tight text-foreground">이 번호가 맞나요?</p>
            <div>
              <StackedInput
                ariaLabel="연락처"
                autoFocus={!value.phone}
                value={value.phone}
                onChange={(next) => {
                  setPhoneTouched(false);
                  patch({ phone: next.slice(0, 11) });
                }}
                onBlur={() => setPhoneTouched(true)}
                format={formatPhone}
                inputMode="tel"
                placeholder="010-0000-0000"
                invalid={showPhoneError}
              />
              {showPhoneError ? (
                <FieldError message="휴대폰 번호를 다시 확인해주세요." />
              ) : (
                <p className="mt-3 flex items-start gap-1.5 text-[13px] leading-relaxed text-muted-foreground">
                  <Info className="mt-[3px] size-3.5 shrink-0" />
                  <span>이 번호로 자동이체 등록·출금 안내 문자가 갑니다.</span>
                </p>
              )}
            </div>
          </div>
        </StepBody>
      )}

      {/* 같은 값으로 다시 물으면 결과도 같다 — 건당 유료 호출을 한 번 더 태우기 전에 되묻는다.
          무엇이 틀렸는지(계좌번호냐 생년월일이냐)까지 짚어줘야 고칠 데를 안다. */}
      <AlertDialog open={confirmRetryOpen} onOpenChange={setConfirmRetryOpen}>
        <AlertDialogContent className="max-w-[320px] rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[17px]">
              {lastRejected?.field === 'account'
                ? '계좌번호가 이전과 같아요'
                : lastRejected?.field === 'payer'
                  ? isPersonal
                    ? '생년월일이 이전과 같아요'
                    : '사업자등록번호가 이전과 같아요'
                  : '입력하신 정보가 이전과 같아요'}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[13px] leading-relaxed">
              {lastRejected?.field === 'account'
                ? '조금 전 이 계좌번호로 확인했을 때 은행에서 찾지 못했습니다. 그대로 다시 확인하면 결과도 같습니다.'
                : lastRejected?.field === 'payer'
                  ? '조금 전 이 번호로 확인했을 때 은행에 등록된 정보와 달랐습니다. 그대로 다시 확인하면 결과도 같습니다.'
                  : '조금 전과 같은 정보입니다. 그대로 다시 확인하면 결과도 같습니다.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel className="h-11 rounded-xl">고쳐서 입력할게요</AlertDialogCancel>
            <AlertDialogAction className="h-11 rounded-xl" onClick={() => void runCheck()}>
              그대로 확인
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <footer className="shrink-0 bg-background px-5 pb-[calc(1rem_+_env(safe-area-inset-bottom))] pt-3">
        {step !== 'bank' && (
          <PrimaryButton disabled={!canProceed}>
            {checking ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                은행에 확인하는 중
              </span>
            ) : step === 'account' ? (
              '다음'
            ) : step === 'payer' ? (
              '계좌 확인하기'
            ) : (
              '이 계좌로 등록하기'
            )}
          </PrimaryButton>
        )}
      </footer>
    </form>
  );
}

function StepBody({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-10 pt-6 ${className ?? ''}`}>
      <h1 className="text-[24px] font-bold leading-[1.35] tracking-tight text-foreground">{title}</h1>
      <div className="mt-7 space-y-4">{children}</div>
    </div>
  );
}

function StackedField({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="mb-1 text-[13px] text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function StackedInput({
  value,
  onChange,
  onBlur,
  placeholder,
  invalid,
  autoFocus,
  inputRef,
  format,
  inputMode = 'numeric',
  ariaLabel,
  disabled,
  describedBy,
}: {
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  placeholder: string;
  invalid?: boolean;
  autoFocus?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  format?: (value: string) => string;
  inputMode?: 'numeric' | 'tel';
  ariaLabel?: string;
  disabled?: boolean;
  describedBy?: string;
}) {
  return (
    <Input
      ref={inputRef}
      autoFocus={autoFocus}
      value={format ? format(value) : value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
      onBlur={onBlur}
      placeholder={placeholder}
      inputMode={inputMode}
      aria-label={ariaLabel}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      disabled={disabled}
      className="h-14 rounded-none border-0 border-b border-border bg-transparent px-0 !text-[22px] font-semibold tracking-tight shadow-none focus-visible:border-primary focus-visible:ring-0"
    />
  );
}

function FieldError({ message, id }: { message: string | null; id?: string }) {
  if (!message) return null;
  return (
    <p
      id={id}
      className="mt-3.5 flex items-start gap-2 text-[13.5px] font-medium leading-[1.6] text-destructive animate-in fade-in slide-in-from-top-1 duration-200"
    >
      <AlertCircle className="mt-[3px] size-4 shrink-0" />
      <span>{message}</span>
    </p>
  );
}

function PrimaryButton({ disabled, children }: { disabled?: boolean; children: React.ReactNode }) {
  return (
    <Button
      type="submit"
      disabled={disabled}
      className="h-14 w-full rounded-2xl text-[16px] font-semibold transition-transform duration-150 active:scale-[0.985] disabled:active:scale-100"
    >
      {children}
    </Button>
  );
}
