'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCardPromotions, getInterestFreeMonths, getCardIssuer } from './use-card-promotions';
import { VirtualAccountDialog } from './virtual-account-dialog';
import type { BusinessLicenseInfo } from '@/lib/wallet-api';
import { SheetSelect } from '@/components/ui/sheet-select';
import { NormalPaymentMethods } from './normal-payment-methods';
import { readPaymentPreference } from '@/lib/payment-preference';

export interface CheckoutCard {
  id: string;
  name: string;
  number: string;
  type: '신용' | '체크';
  color: string;
  cardImgUrl?: string | null;
  iconUrl?: string | null;
  installmentMinimumAmount?: number;
}

export interface CheckoutSelection {
  cardCompany?: string;
  cardId: string | null;
  points: number;
  installment: number;
  method: string;
}

interface Props {
  preferenceScope?: string;
  preferredCardId?: string | null;
  agreement?: ReactNode;
  agreementAccepted?: boolean;
  customer?: BusinessLicenseInfo | null;
  orderName: string;
  amount: number;
  availablePoints: number;
  cards: CheckoutCard[];
  onRegister: () => void;
  onSettings: () => void;
  onClose: () => void;
  onPay: (selection: CheckoutSelection) => void;
  loading?: boolean;
  error?: string | null;
  testMode?: boolean;
}

const won = (value: number) => `${value.toLocaleString('ko-KR')}원`;

// 등록 카드의 iconUrl은 상품 이미지가 아니며 테스트 응답에서 카드명과 다른 은행일 수 있다.
// 상품 이미지가 없으면 카드명에 맞는 은행 로고와 색상을 사용한다.
const cardBrands = [
  { name: '카카오', logo: 'kakao', background: '#ffdf00' },
  { name: '신한', logo: 'shinhan', background: '#e8edff' },
  { name: '현대', logo: 'hyundai', background: '#e9eaec' },
  { name: '삼성', logo: 'samsung', background: '#e8efff' },
  { name: '롯데', logo: 'lotte', background: '#f0ece9' },
  { name: '토스', logo: 'toss', background: '#dfeaff' },
  { name: '하나', logo: 'hana', background: '#dcefe8' },
  { name: '국민', logo: 'kb', background: '#fff0c2' },
  { name: '비씨', logo: 'bc', background: '#ffe6e8' },
  { name: '농협', logo: 'nh', background: '#e8f1de' },
  { name: '우리', logo: 'woori', background: '#cce7f4' },
];

function RadioMark({ selected }: { selected: boolean }) {
  return (
    <span
      className={`flex size-6 shrink-0 items-center justify-center rounded-full border-2 ${selected ? 'border-primary bg-primary' : 'border-border bg-white'}`}
    >
      {selected && <span className="size-2 rounded-full bg-white" />}
    </span>
  );
}

/** 직접 만든 카드 선택 UI. 등록과 결제는 호출자가 연결하며 카드 번호 원문은 받지 않는다. */
export function CardCheckout({
  preferenceScope,
  preferredCardId,
  agreement,
  agreementAccepted,
  customer,
  orderName,
  amount,
  availablePoints,
  cards,
  onRegister,
  onSettings,
  onClose,
  onPay,
  loading = false,
  error,
  testMode = false,
}: Props) {
  const footerSlotRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  const [footerHeight, setFooterHeight] = useState(176);
  const [footerDocked, setFooterDocked] = useState(false);

  useEffect(() => {
    if (!footerSlotRef.current || !footerRef.current) return;
    const visibility = new IntersectionObserver(([entry]) => setFooterDocked(entry.isIntersecting));
    const size = new ResizeObserver(() => setFooterHeight(footerRef.current?.getBoundingClientRect().height ?? 176));
    visibility.observe(footerSlotRef.current);
    size.observe(footerRef.current);
    return () => {
      visibility.disconnect();
      size.disconnect();
    };
  }, []);

  const [mode, setMode] = useState<'saved' | 'normal'>('normal');
  const [cardId, setCardId] = useState<string | null>(cards[0]?.id ?? null);
  const [normalMethod, setNormalMethod] = useState('신용·체크카드');
  const [normalCardCompany, setNormalCardCompany] = useState<string | null>(null);
  const [points, setPoints] = useState(0);
  const [pointsOpen, setPointsOpen] = useState(true);
  const [installment, setInstallment] = useState(0);
  const [paymentAttempted, setPaymentAttempted] = useState(false);
  const [previewAgreed, setPreviewAgreed] = useState(false);
  const agreementRef = useRef<HTMLDivElement>(null);
  const validationRef = useRef<HTMLParagraphElement>(null);
  const [depositOpen, setDepositOpen] = useState(false);
  const [carouselRef, carousel] = useEmblaCarousel({ align: 'center', containScroll: false });
  const restoredCard = useRef(false);

  useEffect(() => {
    if (!preferenceScope) return;
    const previous = readPaymentPreference(preferenceScope);
    if (!previous) return;
    setMode(previous.method === 'BRANDPAY' ? 'saved' : 'normal');
    if (previous.method !== 'BRANDPAY') {
      setNormalMethod(previous.method);
      setNormalCardCompany(previous.cardCompany ?? null);
    }
  }, [preferenceScope]);

  useEffect(() => {
    if (!carousel) return;
    const selectCard = () => {
      setCardId(cards[carousel.selectedScrollSnap()]?.id ?? null);
      setInstallment(0);
    };
    carousel.on('select', selectCard).on('reInit', selectCard);
    if (!restoredCard.current && cards.length > 0) {
      const preferredIndex = cards.findIndex((card) => card.id === preferredCardId);
      carousel.scrollTo(preferredIndex >= 0 ? preferredIndex : 0, true);
      restoredCard.current = true;
    }
    selectCard();
    return () => {
      carousel.off('select', selectCard).off('reInit', selectCard);
    };
  }, [carousel, cards, preferredCardId]);

  const promotions = useCardPromotions();
  const selectedCard = cards.find((card) => card.id === cardId);
  const maxPoints = Math.min(amount, availablePoints);
  const payable = amount - points;
  const cardSelected = mode === 'saved' && Boolean(selectedCard);
  const canPay =
    payable === 0 || (mode === 'normal' && (normalMethod !== '신용·체크카드' || !!normalCardCompany)) || cardSelected;

  const validationMessage =
    paymentAttempted && !canPay
      ? mode === 'normal'
        ? '카드사를 선택해주세요.'
        : cards.length > 0
          ? '결제할 카드를 선택해주세요.'
          : '결제할 카드를 등록해주세요.'
      : undefined;

  const agreed = agreementAccepted ?? previewAgreed;
  const agreementError = paymentAttempted && canPay && !agreed;

  return (
    <div className="flex min-h-dvh flex-col bg-white text-foreground">
      <header className="sticky top-0 z-20 border-b border-border/40 bg-white">
        <div className="mx-auto flex h-16 max-w-[560px] items-center justify-between px-5">
          <h1 className="text-xl font-bold tracking-tight">주문/결제</h1>
          <button
            type="button"
            onClick={onClose}
            aria-label="결제 화면 닫기"
            className="flex size-11 items-center justify-center rounded-full hover:bg-muted focus-visible:outline-2 focus-visible:outline-foreground/40"
          >
            <X className="size-6" />
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[560px] flex-1 space-y-7 px-4 py-6 sm:px-6">
        {testMode && <p className="text-xs text-muted-foreground">테스트 결제 · 실제로 결제되지 않습니다.</p>}
        <section className="flex items-end justify-between gap-6 px-1 pb-1" aria-label="주문 요약">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">아몬드영</p>
            <p className="mt-2 max-w-[220px] text-sm font-medium leading-relaxed">{orderName}</p>
          </div>
          <div aria-live="polite" className="shrink-0 text-right tabular-nums">
            {payable < amount && <del className="block text-sm text-muted-foreground">{won(amount)}</del>}
            <p className="text-[24px] font-bold tracking-tight">{won(payable)}</p>
          </div>
        </section>

        <section aria-label="결제수단" className="overflow-hidden rounded-2xl border border-[#e9e9e9] bg-white">
          <div className="mx-5 border-b border-border/40">
            <button
              type="button"
              aria-pressed={mode === 'normal'}
              onClick={() => setMode('normal')}
              className="flex min-h-20 w-full items-center gap-3 text-left transition-colors duration-150 active:bg-muted/40"
            >
              <RadioMark selected={mode === 'normal'} />
              <span className="text-xl font-bold">일반결제</span>
            </button>
            {mode === 'normal' && (
              <NormalPaymentMethods
                freeInstallmentMonths={getInterestFreeMonths(promotions, normalCardCompany, payable)}
                validationMessage={validationMessage}
                validationRef={validationRef}
                method={normalMethod}
                onMethodChange={setNormalMethod}
                cardCompany={normalCardCompany}
                onCardCompanyChange={(company) => {
                  setNormalCardCompany(company);
                  setInstallment(0);
                }}
                installment={installment}
                onInstallmentChange={setInstallment}
                amount={payable}
              />
            )}
          </div>
          <button
            type="button"
            aria-pressed={mode === 'saved'}
            onClick={() => setMode('saved')}
            className="flex min-h-[76px] w-full items-center gap-3 px-5 text-left transition-colors duration-150 active:bg-muted/40"
          >
            <RadioMark selected={mode === 'saved'} />
            <span className="text-[19px] font-bold tracking-tight">카드 간편결제</span>
          </button>

          {mode === 'saved' && (
            <>
              {validationMessage && (
                <p
                  id="payment-selection-error"
                  ref={validationRef}
                  role="alert"
                  tabIndex={-1}
                  className="mx-5 mb-4 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 outline-none"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-4 shrink-0 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white"
                  >
                    !
                  </span>
                  {validationMessage}
                </p>
              )}
              <div className="relative">
                <div ref={carouselRef} className="overflow-hidden touch-pan-y">
                  <div role="group" aria-label="등록된 카드 선택" className="flex gap-4 py-1">
                    {cards.map((card) => {
                      const brand = cardBrands.find((item) => card.name.includes(item.name));
                      return (
                        <button
                          key={card.id}
                          type="button"
                          aria-label={`${card.name} ${card.number}`}
                          aria-pressed={cardId === card.id}
                          onClick={() => {
                            carousel?.scrollTo(cards.findIndex((item) => item.id === card.id));
                            setCardId(card.id);
                            setInstallment(0);
                          }}
                          style={{ backgroundColor: card.cardImgUrl ? card.color : (brand?.background ?? '#eef0f3') }}
                          className="transition-transform duration-150 active:scale-[0.985] motion-reduce:transition-none relative aspect-[260/166] basis-[260px] max-w-[calc(100%-4rem)] shrink-0 overflow-hidden rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/40"
                        >
                          {card.cardImgUrl ? (
                            <img src={card.cardImgUrl} alt="" className="absolute inset-0 size-full object-contain" />
                          ) : (
                            <>
                              {brand && (
                                <img
                                  src={`/payment-logos/${brand.logo}.svg`}
                                  alt=""
                                  className="absolute left-6 top-5 size-10 object-contain"
                                />
                              )}
                              <span className="absolute inset-x-6 bottom-6 text-base font-semibold text-[#191f28]">
                                {card.name}
                              </span>
                            </>
                          )}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={onRegister}
                      disabled={loading}
                      className="flex aspect-[260/166] basis-[260px] max-w-[calc(100%-4rem)] shrink-0 flex-col items-center justify-center gap-3 rounded-lg border border-[#e5e8eb] bg-[#f7f8fa] text-[#6b7684] hover:bg-muted focus-visible:outline-2 focus-visible:outline-foreground/40"
                    >
                      <Plus className="size-7" />
                      <span className="text-sm font-medium">카드 추가하기</span>
                    </button>
                  </div>
                </div>
                <div className="pointer-events-none absolute inset-x-4 top-1/2 flex -translate-y-1/2 justify-between">
                  <button
                    type="button"
                    aria-label="이전 카드"
                    onClick={() => carousel?.scrollPrev()}
                    className="pointer-events-auto flex size-6 items-center justify-center rounded-full bg-[#e5e8eb]/80 text-white hover:bg-[#b0b8c1]"
                  >
                    <ChevronLeft className="size-5" />
                  </button>
                  <button
                    type="button"
                    aria-label="다음 카드"
                    onClick={() => carousel?.scrollNext()}
                    className="pointer-events-auto flex size-6 items-center justify-center rounded-full bg-[#e5e8eb]/80 text-white hover:bg-[#b0b8c1]"
                  >
                    <ChevronRight className="size-5" />
                  </button>
                </div>
              </div>
              <div className="mx-auto max-w-[260px] pb-6">
                {selectedCard && (
                  <>
                    <div className="flex min-h-14 items-center justify-between gap-3">
                      <p className="min-w-0 text-xs leading-relaxed text-[#4e5968]">
                        {selectedCard.name} <span className="text-[#b0b8c1]">|</span> {selectedCard.number}
                      </p>
                      <button
                        type="button"
                        onClick={onSettings}
                        disabled={loading}
                        className="min-h-8 shrink-0 rounded-lg bg-[#f2f4f6] px-3 text-xs text-[#4e5968] hover:bg-muted"
                      >
                        설정
                      </button>
                    </div>
                    {selectedCard.type === '신용' &&
                      payable >= Math.max(50000, selectedCard.installmentMinimumAmount ?? 50000) && (
                        <div className="pt-2">
                          <SheetSelect
                            title="할부 선택"
                            value={String(installment)}
                            onChange={(value) => setInstallment(Number(value))}
                            options={[
                              { value: '0', label: '일시불' },
                              ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((month) => ({
                                value: String(month),
                                label: `${month}개월${getInterestFreeMonths(promotions, getCardIssuer(selectedCard.name), payable).includes(month) ? ' (무이자)' : ''}`,
                              })),
                            ]}
                          />
                        </div>
                      )}
                  </>
                )}
              </div>
            </>
          )}
        </section>

        <section aria-label="아몬드영 포인트">
          <button
            type="button"
            aria-expanded={pointsOpen}
            onClick={() => setPointsOpen(!pointsOpen)}
            className="flex min-h-12 w-full items-center justify-between px-1 pb-3 text-left"
          >
            <h2 className="text-lg font-bold">포인트</h2>
            <span className="flex items-center gap-2 text-sm">
              <span className="font-semibold text-foreground">보유 {availablePoints.toLocaleString('ko-KR')}P</span>
              {pointsOpen ? <ChevronUp className="size-5" /> : <ChevronDown className="size-5" />}
            </span>
          </button>
          {pointsOpen && (
            <div className="rounded-2xl border border-[#e9e9e9] bg-white p-5">
              <label htmlFor="checkout-points" className="text-sm font-medium">
                사용할 포인트
              </label>
              <div className="mt-3 flex gap-2">
                <div className="flex min-w-0 flex-1 items-center rounded-xl border border-border px-3 focus-within:border-foreground/40">
                  <input
                    id="checkout-points"
                    inputMode="numeric"
                    type="text"
                    value={points || ''}
                    placeholder="0"
                    onChange={(event) =>
                      setPoints(Math.min(maxPoints, Number(event.target.value.replace(/[^0-9]/g, ''))))
                    }
                    className="h-12 w-full min-w-0 bg-transparent text-right font-semibold outline-none"
                  />
                  <span className="ml-2 text-sm text-muted-foreground">P</span>
                </div>
                <button
                  type="button"
                  onClick={() => setPoints(points === maxPoints ? 0 : maxPoints)}
                  disabled={maxPoints === 0}
                  className="rounded-xl bg-muted px-4 text-sm font-semibold disabled:opacity-50"
                >
                  {points > 0 && points === maxPoints ? '사용 취소' : '전액 사용'}
                </button>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                1P = 1원 · 최대 {maxPoints.toLocaleString('ko-KR')}P 사용 가능
              </p>
            </div>
          )}
        </section>

        <section aria-label="결제 금액" className="border-t border-border/60 bg-white py-5">
          <h2 className="font-bold">결제 금액</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">주문 금액</dt>
              <dd>{won(amount)}</dd>
            </div>
            {points > 0 && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">포인트 사용</dt>
                <dd className="text-foreground">−{won(points)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-border/50 pt-3 font-bold">
              <dt>최종 결제 금액</dt>
              <dd>{won(payable)}</dd>
            </div>
          </dl>
        </section>
      </main>

      <div ref={footerSlotRef} style={{ height: footerHeight }} className="shrink-0" data-payment-footer-slot>
        <footer
          ref={footerRef}
          data-floating={!footerDocked}
          className={`${footerDocked ? 'relative' : 'fixed inset-x-0 bottom-0'} z-30 border-t border-border/40 bg-white pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 ${footerDocked ? '' : 'shadow-[0_-4px_20px_rgba(0,0,0,0.025)]'}`}
        >
          <div className="mx-auto max-w-[560px] space-y-3 px-5 sm:px-6">
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <p aria-live="polite" className="truncate text-sm text-muted-foreground">
              {payable === 0
                ? '포인트로 전액 결제'
                : mode === 'normal'
                  ? normalMethod === '신용·체크카드' && !normalCardCompany
                    ? '카드사를 선택해주세요'
                    : normalMethod
                  : selectedCard
                    ? `${selectedCard.name} (${selectedCard.number})`
                    : '결제할 카드를 등록해주세요'}
            </p>
            <section aria-label="결제 약관" ref={agreementRef} tabIndex={-1} className="outline-none">
              {agreement ?? (
                <label className="flex min-h-12 cursor-pointer items-center gap-3 px-1 text-sm">
                  <input
                    type="checkbox"
                    checked={previewAgreed}
                    onChange={(event) => setPreviewAgreed(event.target.checked)}
                    className="size-5 accent-primary"
                  />
                  필수 약관 전체동의
                </label>
              )}
              {agreementError && (
                <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                  필수 약관에 동의해주세요.
                </p>
              )}
            </section>
            <Button
              type="button"
              disabled={loading}
              onClick={() => {
                if (!canPay) {
                  setPaymentAttempted(true);
                  requestAnimationFrame(() => {
                    validationRef.current?.focus({ preventScroll: true });
                    validationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  });
                  return;
                }
                if (!agreed) {
                  setPaymentAttempted(true);
                  requestAnimationFrame(() => {
                    agreementRef.current?.focus({ preventScroll: true });
                    agreementRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  });
                  return;
                }
                if (mode === 'normal' && normalMethod === '무통장입금' && payable > 0) {
                  setDepositOpen(true);
                  return;
                }
                onPay({
                  cardId: cardSelected ? cardId : null,
                  cardCompany:
                    mode === 'normal' && normalMethod === '신용·체크카드'
                      ? (normalCardCompany ?? undefined)
                      : undefined,
                  points,
                  installment:
                    mode === 'normal'
                      ? payable >= 50000
                        ? installment
                        : 0
                      : payable >= Math.max(50000, selectedCard?.installmentMinimumAmount ?? 50000) &&
                          selectedCard?.type === '신용'
                        ? installment
                        : 0,
                  method: mode === 'saved' ? 'BRANDPAY' : normalMethod,
                });
              }}
              className="h-14 w-full rounded-xl text-lg font-bold"
            >
              {loading
                ? '처리 중...'
                : mode === 'normal' && normalMethod === '무통장입금' && payable > 0
                  ? '입금 은행 선택하기'
                  : `${won(payable)} 결제하기`}
            </Button>
            <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
              주문 내용을 확인했으며, 결제 서비스 이용에 동의합니다.
            </p>
          </div>
        </footer>
      </div>
      <VirtualAccountDialog
        customer={customer}
        open={depositOpen}
        onOpenChange={setDepositOpen}
        orderName={orderName}
        amount={payable}
      />
    </div>
  );
}
