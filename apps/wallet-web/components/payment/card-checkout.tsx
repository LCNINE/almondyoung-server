'use client';

import { useEffect, useState } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import { Check, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, CreditCard, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

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
  cardId: string | null;
  points: number;
  installment: number;
  method: string;
}

interface Props {
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
  const [mode, setMode] = useState<'saved' | 'normal'>('normal');
  const [cardId, setCardId] = useState<string | null>(cards[0]?.id ?? null);
  const [normalMethod, setNormalMethod] = useState('신용·체크카드');
  const [points, setPoints] = useState(0);
  const [pointsOpen, setPointsOpen] = useState(true);
  const [installment, setInstallment] = useState(0);
  const [carouselRef, carousel] = useEmblaCarousel({ align: 'start', containScroll: 'trimSnaps' });
  useEffect(() => {
    if (!carousel) return;
    const selectCard = () => {
      setCardId(cards[carousel.selectedScrollSnap()]?.id ?? null);
      setInstallment(0);
    };
    carousel.on('select', selectCard).on('reInit', selectCard);
    selectCard();
    return () => {
      carousel.off('select', selectCard).off('reInit', selectCard);
    };
  }, [carousel, cards]);
  const selectedCard = cards.find((card) => card.id === cardId);
  const maxPoints = Math.min(amount, availablePoints);
  const payable = amount - points;
  const cardSelected = mode === 'saved' && Boolean(selectedCard);
  const canPay = payable === 0 || mode === 'normal' || cardSelected;

  return (
    <div className="min-h-dvh bg-white pb-[calc(11rem+env(safe-area-inset-bottom))] text-foreground">
      <header className="sticky top-0 z-20 border-b border-border/40 bg-white">
        <div className="mx-auto flex h-16 max-w-[560px] items-center justify-between px-5">
          <h1 className="text-xl font-bold tracking-tight">주문/결제</h1>
          <button
            type="button"
            onClick={onClose}
            aria-label="결제 화면 닫기"
            className="flex size-11 items-center justify-center rounded-full hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"
          >
            <X className="size-6" />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[560px] space-y-7 px-4 py-6 sm:px-6">
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
              className="flex min-h-20 w-full items-center gap-3 text-left"
            >
              <RadioMark selected={mode === 'normal'} />
              <span className="text-xl font-bold">일반결제</span>
            </button>
            {mode === 'normal' && (
              <div role="group" aria-label="일반 결제수단" className="divide-y divide-border/40 pb-5 pl-9">
                {['신용·체크카드', '카카오페이', '네이버페이', '토스페이'].map((method) => (
                  <button
                    key={method}
                    type="button"
                    aria-pressed={normalMethod === method}
                    onClick={() => setNormalMethod(method)}
                    className="flex min-h-14 w-full items-center justify-between text-left text-base font-medium"
                  >
                    {method}
                    {normalMethod === method && <Check className="size-5 text-primary" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            aria-pressed={mode === 'saved'}
            onClick={() => setMode('saved')}
            className="flex min-h-[76px] w-full items-center gap-3 px-5 text-left"
          >
            <RadioMark selected={mode === 'saved'} />
            <span className="text-[19px] font-bold tracking-tight">카드 간편결제</span>
          </button>

          {mode === 'saved' && (
            <>
              <div className="relative ml-5">
                <div ref={carouselRef} className="overflow-hidden touch-pan-y pl-9">
                  <div role="group" aria-label="등록된 카드 선택" className="flex gap-3 pb-3">
                    {cards.map((card) => (
                      <button
                        key={card.id}
                        type="button"
                        aria-pressed={cardId === card.id}
                        onClick={() => {
                          carousel?.scrollTo(cards.findIndex((item) => item.id === card.id));
                          setCardId(card.id);
                          setInstallment(0);
                        }}
                        className={`relative flex min-h-[126px] min-w-0 basis-[94%] shrink-0 items-center gap-4 rounded-xl border-[1.5px] px-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-primary ${cardId === card.id ? 'border-primary bg-white shadow-[0_2px_5px_rgba(0,0,0,0.04)]' : 'border-[#e5e5e5] bg-white'}`}
                      >
                        {card.cardImgUrl || card.iconUrl ? (
                          // API가 제공한 등록 카드 이미지. 카드 번호나 카드 정보 원문은 이미지에 넣지 않는다.
                          <img
                            src={card.cardImgUrl || card.iconUrl || undefined}
                            alt=""
                            className="h-[62px] w-[40px] shrink-0 object-contain"
                          />
                        ) : (
                          <span
                            aria-hidden="true"
                            style={{ backgroundColor: card.color }}
                            className="relative flex h-[72px] w-[46px] shrink-0 flex-col justify-between rounded-md p-2 text-white shadow-sm"
                          >
                            <CreditCard className="size-4 opacity-80" />
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block text-[16px] font-bold leading-snug tracking-tight">{card.name}</span>
                          <span className="mt-1 block text-sm text-muted-foreground">
                            {card.type} · {card.number}
                          </span>
                          <span className="mt-2 flex items-center gap-1 text-sm font-medium">
                            {installment === 0 || cardId !== card.id ? '일시불' : `${installment}개월 할부`}
                            <ChevronDown className="size-3.5 text-muted-foreground" />
                          </span>
                        </span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={onRegister}
                      disabled={loading}
                      className="flex min-h-[126px] min-w-0 basis-[94%] shrink-0 flex-col items-center justify-center gap-2 rounded-xl border border-[#e5e5e5] bg-[#fafafa] hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      <span className="flex size-7 items-center justify-center rounded-full bg-primary">
                        <Plus className="size-5 text-white" />
                      </span>
                      <span className="text-base font-semibold">카드 등록하기</span>
                    </button>
                  </div>
                </div>
                <div className="pointer-events-none absolute inset-x-0 top-[47px] flex justify-between pr-1">
                  <button
                    type="button"
                    aria-label="이전 카드"
                    onClick={() => carousel?.scrollPrev()}
                    className="pointer-events-auto flex size-7 items-center justify-center rounded-full border border-[#eeeeee] bg-white/95 text-muted-foreground hover:text-foreground"
                  >
                    <ChevronLeft className="size-5" />
                  </button>
                  <button
                    type="button"
                    aria-label="다음 카드"
                    onClick={() => carousel?.scrollNext()}
                    className="pointer-events-auto flex size-7 items-center justify-center rounded-full border border-[#eeeeee] bg-white/95 text-muted-foreground hover:text-foreground"
                  >
                    <ChevronRight className="size-5" />
                  </button>
                </div>
              </div>
              <div className="flex justify-end px-5 pb-3">
                <button
                  type="button"
                  onClick={onSettings}
                  disabled={loading}
                  className="min-h-8 px-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  카드 관리
                </button>
              </div>
              {selectedCard?.type === '신용' &&
                payable >= Math.max(50000, selectedCard.installmentMinimumAmount ?? 50000) && (
                  <div className="px-5 pb-5">
                    <label className="flex items-center justify-between gap-3 text-sm">
                      할부 선택
                      <select
                        aria-label="할부 개월"
                        value={installment}
                        onChange={(event) => setInstallment(Number(event.target.value))}
                        className="min-h-11 rounded-lg border border-border bg-white px-3"
                      >
                        <option value={0}>일시불</option>
                        {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((month) => (
                          <option key={month} value={month}>
                            {month}개월
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
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
            <h2 className="text-lg font-bold">포인트 사용</h2>
            <span className="flex items-center gap-2 text-sm">
              <span className="font-semibold text-primary">{availablePoints.toLocaleString('ko-KR')}P</span>
              {pointsOpen ? <ChevronUp className="size-5" /> : <ChevronDown className="size-5" />}
            </span>
          </button>
          {pointsOpen && (
            <div className="rounded-2xl border border-[#e9e9e9] bg-white p-5">
              <label htmlFor="checkout-points" className="text-sm font-medium">
                아몬드영 포인트
              </label>
              <div className="mt-3 flex gap-2">
                <div className="flex min-w-0 flex-1 items-center rounded-xl border border-border px-3 focus-within:border-primary">
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
                <dd className="text-primary">−{won(points)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-border/50 pt-3 font-bold">
              <dt>최종 결제 금액</dt>
              <dd>{won(payable)}</dd>
            </div>
          </dl>
        </section>
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-border/40 bg-white pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 shadow-[0_-4px_20px_rgba(0,0,0,0.025)]">
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
                ? normalMethod
                : selectedCard
                  ? `${selectedCard.name} (${selectedCard.number})`
                  : '결제할 카드를 등록해주세요'}
          </p>
          <Button
            type="button"
            disabled={!canPay || loading}
            onClick={() =>
              onPay({
                cardId: cardSelected ? cardId : null,
                points,
                installment:
                  payable >= Math.max(50000, selectedCard?.installmentMinimumAmount ?? 50000) &&
                  selectedCard?.type === '신용'
                    ? installment
                    : 0,
                method: mode === 'saved' ? 'BRANDPAY' : normalMethod,
              })
            }
            className="h-14 w-full rounded-xl text-lg font-bold"
          >
            {loading ? '처리 중...' : `${won(payable)} 결제하기`}
          </Button>
          <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
            주문 내용을 확인했으며, 결제 서비스 이용에 동의합니다.
          </p>
        </div>
      </footer>
    </div>
  );
}
