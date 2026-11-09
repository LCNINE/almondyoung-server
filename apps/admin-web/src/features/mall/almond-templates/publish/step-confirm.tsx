'use client';

import { ImageIcon } from 'lucide-react';
import { cn } from '@/lib/utils/ui';
import { memberPriceFor, won, type DiscountPct } from './publish-model';

interface StepConfirmProps {
  thumbnailUrl: string;
  name: string;
  selling: { price: number; cost: number }[];
  discountPct: DiscountPct;
  problems: string[];
  pending: number;
}

export function StepConfirm({ thumbnailUrl, name, selling, discountPct, problems, pending }: StepConfirmProps) {
  const prices = selling.map((s) => s.price);
  const ratios = selling.map((s) => s.price / s.cost);
  const min = prices.length ? Math.min(...prices) : 0;
  const max = prices.length ? Math.max(...prices) : 0;
  const ratioMin = ratios.length ? Math.min(...ratios).toFixed(1) : '0';
  const ratioMax = ratios.length ? Math.max(...ratios).toFixed(1) : '0';

  const checks: { ok: boolean; text: string }[] = [
    ...problems.map((text) => ({ ok: false, text })),
    ...(pending > 0 ? [{ ok: false, text: `견적을 불러오는 조합이 ${pending}개 남았어요` }] : []),
  ];
  if (checks.length === 0) {
    checks.push(
      {
        ok: true,
        text: discountPct ? '멤버십가까지 원가보다 싸게 파는 조합이 없어요' : '원가보다 싸게 파는 조합이 없어요',
      },
      { ok: true, text: '모든 조합의 원가를 오늘 와우프레스 견적으로 불러왔어요' },
      { ok: true, text: '자동 발주 연결: 조합마다 와우프레스 옵션 코드가 정해졌어요' },
      { ok: true, text: '처음 몇 건은 테스트 주문으로 접수돼요. 전화 확인 뒤 자동 발주로 바뀌어요' }
    );
  }
  checks.push({
    ok: true,
    text: discountPct
      ? `멤버십 회원은 판매가에서 ${discountPct}% 할인돼요 (최저 ${won(memberPriceFor(min, discountPct))})`
      : '멤버십 할인은 없어요. 회원도 판매가로 사요',
  });

  return (
    <div className="grid gap-5 text-sm sm:grid-cols-[220px_1fr]">
      <div>
        <div className="overflow-hidden rounded-xl border">
          <div className="bg-muted relative aspect-[9/5]">
            <div className="text-muted-foreground flex h-full items-center justify-center">
              <ImageIcon className="h-6 w-6" />
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={thumbnailUrl} alt="" className="absolute inset-0 h-full w-full object-contain" />
          </div>
          <div className="px-3 py-2.5">
            <div className="truncate">{name}</div>
            <div className="mt-1 font-bold">{selling.length ? `${won(min)}부터` : '-'}</div>
          </div>
        </div>
        <p className="text-muted-foreground mt-2 text-xs">고객 목록에는 이렇게 보여요.</p>
      </div>

      <div>
        <div className="mb-3.5 grid grid-cols-3 gap-2.5">
          <div className="bg-muted/50 rounded-lg p-3">
            <div className="text-muted-foreground text-xs">판매 조합</div>
            <div className="mt-1 text-base font-bold">{selling.length}개</div>
          </div>
          <div className="bg-muted/50 rounded-lg p-3">
            <div className="text-muted-foreground text-xs">판매가</div>
            <div className="mt-1 text-base font-bold">
              {selling.length === 0 ? '-' : min === max ? won(min) : `${won(min)}~${max.toLocaleString('ko-KR')}`}
            </div>
          </div>
          <div className="bg-muted/50 rounded-lg p-3">
            <div className="text-muted-foreground text-xs">원가의</div>
            <div className="mt-1 text-base font-bold">{selling.length ? `${ratioMin}~${ratioMax}배` : '-'}</div>
          </div>
        </div>

        <ul className="leading-8">
          {checks.map((c) => (
            <li key={c.text} className={cn(!c.ok && 'text-destructive')}>
              <span className={cn('mr-1 font-bold', c.ok ? 'text-green-700' : 'text-destructive')}>
                {c.ok ? '✓' : '!'}
              </span>
              {c.text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
