'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertCircle, Check, ChevronLeft, Loader2, Pencil } from 'lucide-react';
import { CMS_BANKS, getBankName } from '@/lib/cms-banks';
import { AccountHolderType } from '@/components/payer-number-field';
import { isValidPayerNumber } from '@/lib/payer-number';

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

const STOREFRONT_ORIGIN = process.env.NEXT_PUBLIC_STOREFRONT_ORIGIN ?? '/';

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

interface CmsAccountFieldsProps {
  value: CmsAccountDetails;
  onChange: (next: CmsAccountDetails) => void;
  /** 모든 단계를 통과했다 — 부모가 동의 단계로 넘긴다. */
  onComplete: () => void;
  /** 로고를 눌렀을 때 돌아갈 곳. 없으면 스토어프론트 홈. */
  homeHref?: string;
}

/**
 * 계좌 등록 입력을 «한 화면에 하나씩» 묻는다. 은행 → 계좌번호 → 예금주 정보 →
 * 은행 조회 → 확인. 마지막 입력이 끝나는 자리에서 바로 조회가 돌기 때문에,
 * 고객은 «등록했는데 이틀 뒤 거절» 대신 그 자리에서 결과를 본다.
 */
export function CmsAccountFields({ value, onChange, onComplete, homeHref }: CmsAccountFieldsProps) {
  const [step, setStep] = useState<Step>('bank');
  const { height: viewportHeight, keyboardOpen } = useViewportHeight();
  const payerNumberRef = useRef<HTMLInputElement>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 조회가 끝났지만 은행이 확인해주지 못한 상태. 등록은 계속할 수 있다. */
  const [unverified, setUnverified] = useState(false);

  const patch = (next: Partial<CmsAccountDetails>) => onChange({ ...value, ...next });

  const runCheck = async () => {
    setChecking(true);
    setError(null);
    setUnverified(false);
    try {
      const res = await fetch('/api/billing/cms-check-account', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentCompany: value.paymentCompany,
          paymentNumber: value.paymentNumber,
          payerNumber: value.payerNumber,
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

      if (!res.ok) {
        // 호출 상한(429)·인증·장애 — 어느 쪽도 «계좌가 틀렸다»는 확답이 아니므로 등록을 막지 않는다.
        setError(data.error ?? '계좌를 확인하지 못했습니다.');
        setUnverified(true);
        setStep('confirm');
        return;
      }
      if (data.verified) {
        patch({ payerName: data.payerName ?? value.payerName });
        setStep('confirm');
        return;
      }

      const message = data.message ?? '계좌를 확인하지 못했습니다.';
      const back = data.providerCode ? STEP_BY_PROVIDER_CODE[data.providerCode] : undefined;
      setError(message);
      if (data.reason === 'MISMATCH' && back) {
        setStep(back);
        return;
      }
      setUnverified(true);
      setStep('confirm');
    } catch {
      setError('계좌 확인 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
      setUnverified(true);
      setStep('confirm');
    } finally {
      setChecking(false);
    }
  };

  const back = () => {
    setError(null);
    if (step === 'account') setStep('bank');
    if (step === 'payer') setStep('account');
    if (step === 'confirm') setStep('payer');
  };

  const isPersonal = value.holderType === 'personal';

  const canProceed =
    step === 'account'
      ? value.paymentNumber.length >= 4
      : step === 'payer'
        ? isValidPayerNumber(value.payerNumber) && !checking
        : step === 'confirm'
          ? Boolean(value.payerName) && value.phone.length >= 8
          : false;

  // 엔터(모바일 키보드의 완료·이동)로도 그 단계의 주 버튼과 같은 일이 일어난다.
  const proceed = () => {
    if (!canProceed) return;
    if (step === 'account') setStep('payer');
    else if (step === 'payer') void runCheck();
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
          href={homeHref ?? STOREFRONT_ORIGIN}
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

      {step === 'bank' && (
        <StepBody title="어느 은행 계좌인가요?">
          <div className="-mx-1 grid grid-cols-3 gap-2">
            {CMS_BANKS.map((bank) => (
              <button
                key={bank.code}
                type="button"
                onClick={() => {
                  patch({ paymentCompany: bank.code });
                  setStep('account');
                }}
                className={`flex h-[72px] flex-col items-center justify-center rounded-2xl border text-[13px] font-medium transition-colors ${
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
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-8 pt-2">
          <h1 className="text-[24px] font-bold leading-[1.35] tracking-tight text-foreground">
            계좌 정보를 입력해주세요
          </h1>

          {/* toss.tech/article/toss-signup-process — 필드를 «역순»으로 쌓는다. 새로 물어보는 칸이
              위에 오고 이미 채운 칸이 아래로 밀린다. 키보드가 하단을 덮어도 지금 입력할 칸은
              항상 보인다. 순서가 거꾸로인 건 사용자가 알아채지 못한다(집중하는 칸만 본다). */}
          <div className="mt-7 space-y-7">
            {step === 'payer' && (
              <StackedField label={isPersonal ? '예금주 생년월일' : '사업자등록번호'}>
                <div className="mb-3 grid grid-cols-2 gap-2">
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
                      className={`h-11 rounded-xl border text-sm font-medium transition-colors ${
                        value.holderType === type
                          ? 'border-primary text-primary'
                          : 'border-transparent bg-muted/60 text-muted-foreground'
                      }`}
                    >
                      {type === 'personal' ? '개인 명의' : '사업자 명의'}
                    </button>
                  ))}
                </div>
                <StackedInput
                  autoFocus
                  inputRef={payerNumberRef}
                  value={value.payerNumber}
                  onChange={(next) => {
                    setError(null);
                    patch({ payerNumber: next.slice(0, isPersonal ? 6 : 10) });
                  }}
                  placeholder={isPersonal ? 'YYMMDD' : '0000000000'}
                  invalid={Boolean(error)}
                />
                <FieldError message={error} />
                <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
                  {isPersonal
                    ? '계좌를 만들 때 등록한 생년월일이어야 은행에서 확인됩니다.'
                    : '계좌가 사업자(상호) 명의일 때만 선택하세요. 대표자 개인 계좌라면 개인 명의입니다.'}
                </p>
              </StackedField>
            )}

            <StackedField label="계좌번호">
              <StackedInput
                autoFocus={step === 'account'}
                value={value.paymentNumber}
                onChange={(next) => {
                  setError(null);
                  patch({ paymentNumber: next.slice(0, 16) });
                }}
                placeholder="- 없이 숫자만 입력"
                invalid={step === 'account' && Boolean(error)}
              />
              {step === 'account' && <FieldError message={error} />}
            </StackedField>

            <StackedField label="은행">
              <button
                type="button"
                onClick={() => setStep('bank')}
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
        <StepBody title={unverified ? '입력하신 계좌입니다' : '이 계좌가 맞나요?'}>
          <div className="rounded-2xl bg-muted/60 p-5">
            {value.payerName && (
              <p className="text-[20px] font-bold tracking-tight text-foreground">{value.payerName}</p>
            )}
            <p className={`text-sm text-muted-foreground ${value.payerName ? 'mt-1' : ''}`}>
              {getBankName(value.paymentCompany)} {value.paymentNumber}
            </p>
            {!unverified && (
              <p className="mt-3 flex items-center gap-1.5 text-[13px] font-medium text-primary">
                <Check className="h-4 w-4" />
                은행에서 확인된 계좌입니다
              </p>
            )}
          </div>

          {unverified && (
            <div className="flex items-start gap-2 rounded-xl bg-muted/60 p-4 text-[13px] leading-relaxed text-muted-foreground">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
              <div>
                <p>{error ?? '지금은 계좌를 실시간으로 확인할 수 없습니다.'}</p>
                <p className="mt-1">확인 없이도 등록할 수 있지만, 정보가 다르면 1~2 영업일 뒤에 거절됩니다.</p>
              </div>
            </div>
          )}

          {unverified && !value.payerName && (
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

          <div className="space-y-2">
            <label htmlFor="phone" className="text-[13px] font-medium text-foreground">
              연락처
            </label>
            <Input
              id="phone"
              value={value.phone}
              onChange={(e) => patch({ phone: e.target.value.replace(/\D/g, '').slice(0, 20) })}
              placeholder="01012345678"
              inputMode="tel"
              className="h-12"
            />
          </div>
        </StepBody>
      )}

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

function StepBody({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-8 pt-2">
      <h1 className="text-[24px] font-bold leading-[1.35] tracking-tight text-foreground">{title}</h1>
      <div className="mt-6 space-y-4">{children}</div>
    </div>
  );
}

function StackedField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[13px] text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function StackedInput({
  value,
  onChange,
  placeholder,
  invalid,
  autoFocus,
  inputRef,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  invalid?: boolean;
  autoFocus?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <Input
      ref={inputRef}
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
      placeholder={placeholder}
      inputMode="numeric"
      aria-invalid={invalid}
      className="h-14 rounded-none border-0 border-b border-border bg-transparent px-0 !text-[22px] font-semibold tracking-tight shadow-none focus-visible:border-primary focus-visible:ring-0"
    />
  );
}

function FieldError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="flex items-start gap-1.5 text-[13px] leading-relaxed text-destructive">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      {message}
    </p>
  );
}

function PrimaryButton({ disabled, children }: { disabled?: boolean; children: React.ReactNode }) {
  return (
    <Button type="submit" disabled={disabled} className="h-14 w-full rounded-2xl text-[16px] font-semibold">
      {children}
    </Button>
  );
}
