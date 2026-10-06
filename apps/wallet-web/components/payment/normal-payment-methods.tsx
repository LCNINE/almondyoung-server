'use client';

import { useEffect, useState, type Ref } from 'react';
import Image from 'next/image';
import useEmblaCarousel from 'embla-carousel-react';
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import { SheetSelect } from '@/components/ui/sheet-select';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

const CARDS = [
  { name: '신한', code: '41', logo: '/payment-logos/shinhan.svg' },
  { name: '현대', code: '61', logo: '/payment-logos/hyundai.svg' },
  { name: '삼성', code: '51', logo: '/payment-logos/samsung.svg' },
  { name: '롯데', code: '71', logo: '/payment-logos/lotte.svg' },
  { name: '토스뱅크', code: '24', logo: '/payment-logos/toss.svg' },
  { name: '하나', code: '21', logo: '/payment-logos/hana.svg' },
  { name: '국민', code: '11', logo: '/payment-logos/kb.svg' },
  { name: '비씨', code: '31', logo: '/payment-logos/bc.svg' },
  { name: '농협', code: '91', logo: '/payment-logos/nh.svg' },
  { name: '우리', code: '33', logo: '/payment-logos/woori.svg' },
  { name: '카카오뱅크', code: '15', logo: '/payment-logos/kakao.svg' },
  { name: '전북', code: '35', logo: '/banks/jb.png' },
  { name: '광주', code: '46', logo: '/banks/kwangju.png' },
  { name: '기업비씨', code: '3K', logo: '/banks/ibk.png' },
  { name: '수협', code: '34', logo: '/banks/suhyup.png' },
  { name: '우체국', code: '37', logo: '/banks/postoffice.png' },
];

export function NormalPaymentMethods({
  freeInstallmentMonths = [],
  validationMessage,
  validationRef,
  method,
  onMethodChange,
  cardCompany,
  onCardCompanyChange,
  installment,
  onInstallmentChange,
  amount,
}: {
  freeInstallmentMonths?: number[];
  validationMessage?: string;
  validationRef?: Ref<HTMLParagraphElement>;
  method: string;
  onMethodChange: (method: string) => void;
  cardCompany: string | null;
  onCardCompanyChange: (company: string) => void;
  installment: number;
  onInstallmentChange: (months: number) => void;
  amount: number;
}) {
  const [methodsRef, methodsCarousel] = useEmblaCarousel({
    align: 'start',
    dragFree: true,
    containScroll: 'trimSnaps',
  });
  const [canPrevMethod, setCanPrevMethod] = useState(false);
  const [canNextMethod, setCanNextMethod] = useState(false);
  useEffect(() => {
    if (!methodsCarousel) return;
    const update = () => {
      setCanPrevMethod(methodsCarousel.canScrollPrev());
      setCanNextMethod(methodsCarousel.canScrollNext());
    };
    update();
    methodsCarousel.on('select', update).on('reInit', update);
    return () => {
      methodsCarousel.off('select', update).off('reInit', update);
    };
  }, [methodsCarousel]);
  const [more, setMore] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideUrl, setGuideUrl] = useState<string | null>(null);
  const [guideError, setGuideError] = useState(false);
  const showGuide = async () => {
    setGuideOpen(true);
    if (guideUrl) return;
    setGuideError(false);
    try {
      const response = await fetch('/api/toss/promotions', { cache: 'no-store' });
      if (!response.ok) throw new Error('Installment guide unavailable');
      const body = (await response.json()) as { url: string };
      setGuideUrl(body.url);
    } catch {
      setGuideError(true);
    }
  };
  const methodButton =
    'flex min-h-14 items-center justify-center rounded border px-1 text-center text-xs sm:text-sm transition-[background-color,border-color,transform] duration-150 active:scale-[0.98] motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-foreground/40';
  return (
    <>
      <div role="group" aria-label="일반 결제수단" className="pb-5">
        <button
          type="button"
          aria-pressed={method === '무통장입금'}
          onClick={() => onMethodChange('무통장입금')}
          className={`${methodButton} mb-2 w-full ${method === '무통장입금' ? 'border-foreground font-semibold' : 'border-border/70 bg-white hover:bg-muted/30'}`}
        >
          무통장입금
        </button>
        <div className="relative">
          <div ref={methodsRef} className="overflow-hidden touch-pan-y">
            <div className="flex gap-2" role="group" aria-label="일반 결제수단 가로 목록">
              {['신용·체크카드', '카카오페이', '토스페이', '네이버페이'].map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={method === item}
                  onClick={() => onMethodChange(item)}
                  className={`${methodButton} shrink-0 basis-[calc((100%-3rem)/3)] ${method === item ? 'border-foreground font-semibold' : 'border-border/70 bg-white hover:bg-muted/30'}`}
                >
                  {item === '카카오페이' || item === '토스페이' ? (
                    <Image
                      src={`/payment-logos/${item === '카카오페이' ? 'kakaopay' : 'tosspay'}.svg`}
                      alt={item}
                      width={78}
                      height={42}
                      className="h-10 w-[78px] object-contain"
                    />
                  ) : item === '네이버페이' ? (
                    <span className="flex items-center gap-1 whitespace-nowrap">
                      <Image src="/payment-logos/icn-bank-naverpay.png" alt="" width={22} height={22} />
                      네이버페이
                    </span>
                  ) : (
                    item
                  )}
                </button>
              ))}
            </div>
          </div>
          {canPrevMethod && (
            <button
              type="button"
              aria-label="이전 일반 결제수단"
              onClick={() => methodsCarousel?.scrollPrev()}
              className="absolute -left-3 top-1/2 hidden size-7 -translate-y-1/2 sm:flex items-center justify-center rounded-full border border-[#e5e8eb] bg-white text-[#4e5968] shadow-sm"
            >
              <ChevronLeft className="size-4" />
            </button>
          )}
          {canNextMethod && (
            <button
              type="button"
              aria-label="다음 일반 결제수단"
              onClick={() => methodsCarousel?.scrollNext()}
              className="absolute -right-3 top-1/2 hidden size-7 -translate-y-1/2 sm:flex items-center justify-center rounded-full border border-[#e5e8eb] bg-white text-[#4e5968] shadow-sm"
            >
              <ChevronRight className="size-4" />
            </button>
          )}
        </div>
        {validationMessage && (
          <p
            id="payment-selection-error"
            ref={validationRef}
            role="alert"
            tabIndex={-1}
            className="mt-3 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 outline-none"
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
        {method === '신용·체크카드' && (
          <div className="pt-4 animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none">
            <div role="group" aria-label="카드사 선택" className="grid grid-cols-4 gap-x-1 gap-y-2">
              {(more ? CARDS : CARDS.slice(0, 11)).map((card) => (
                <button
                  key={card.code}
                  type="button"
                  aria-pressed={cardCompany === card.code}
                  onClick={() => onCardCompanyChange(card.code)}
                  className={`flex min-h-[72px] flex-col items-center justify-center gap-2 rounded border px-1 py-2 text-xs focus-visible:outline-2 focus-visible:outline-foreground/40 ${cardCompany === card.code ? 'border-foreground' : 'border-transparent hover:bg-muted/40'}`}
                >
                  <Image src={card.logo} alt="" width={44} height={28} className="h-7 w-11 object-contain" />
                  {card.name}
                </button>
              ))}
              <button
                type="button"
                aria-expanded={more}
                onClick={() => setMore(!more)}
                className="flex min-h-[72px] flex-col items-center justify-center gap-2 rounded text-xs text-muted-foreground hover:bg-muted/40"
              >
                <MoreHorizontal className="size-7" />
                {more ? '접기' : '더보기'}
              </button>
            </div>
            {cardCompany && (
              <div className="mt-4 rounded-xl bg-[#f7f8fa] p-3">
                <p className="mb-2 text-sm">할부</p>
                <SheetSelect
                  title="할부 선택"
                  value={String(amount >= 50000 ? installment : 0)}
                  onChange={(value) => onInstallmentChange(Number(value))}
                  options={[
                    { value: '0', label: '일시불' },
                    ...(amount >= 50000
                      ? [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((month) => ({
                          value: String(month),
                          label: `${month}개월${freeInstallmentMonths.includes(month) ? ' (무이자)' : ''}`,
                        }))
                      : []),
                  ]}
                />
                {amount < 50000 && (
                  <p className="mt-2 text-xs text-muted-foreground">할부는 50,000원 이상 결제 시 선택할 수 있습니다.</p>
                )}
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => void showGuide()}
          className="mt-3 flex min-h-10 items-center gap-1 text-xs text-muted-foreground"
        >
          신용카드 무이자 할부 안내
          <ChevronRight className="size-3.5" />
        </button>
      </div>
      <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
        <DialogContent className="max-h-[85dvh] overflow-hidden rounded-2xl bg-white p-0 pt-10 sm:max-w-[640px]">
          <DialogTitle className="sr-only">무이자 할부 안내</DialogTitle>
          <DialogDescription className="sr-only">토스페이먼츠의 결제 금액별 카드사 행사 안내</DialogDescription>
          {guideError ? (
            <p className="p-6 text-sm text-muted-foreground">
              무이자 안내를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.
            </p>
          ) : guideUrl ? (
            <iframe
              title="카드사별 무이자 할부 안내"
              src={`${guideUrl}&amount=${Math.max(50000, amount)}`}
              className="h-[75dvh] w-full rounded-2xl border-0"
            />
          ) : (
            <p className="p-6 text-sm text-muted-foreground">행사 정보를 확인하고 있습니다.</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
