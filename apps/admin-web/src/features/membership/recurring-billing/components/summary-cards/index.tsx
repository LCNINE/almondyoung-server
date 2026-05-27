'use client';

import { useRouter, usePathname } from 'next/navigation';
import { AdminRecurringBillingOverview } from '@/lib/types/dto/wallet';

type SummaryCardsProps = {
  overview: AdminRecurringBillingOverview;
};

type CardConfig = {
  label: string;
  count: number;
  query: string;
  accent?: boolean;
};

export function RecurringBillingSummaryCards({ overview }: SummaryCardsProps) {
  const router = useRouter();
  const pathname = usePathname();

  const cards: CardConfig[] = [
    {
      label: '처리 필요',
      count: overview.needsAction,
      query: 'view=needs-action&page=1',
      accent: true,
    },
    {
      label: '결제수단 심사 중',
      count: overview.memberPending,
      query: 'view=members&cmsMemberStatus=PENDING&page=1',
    },
    {
      label: '심사 실패',
      count: overview.memberFailed,
      query: 'view=members&cmsMemberStatus=FAILED&page=1',
      accent: true,
    },
    {
      label: '출금 예정',
      count: overview.withdrawalRequested,
      query: 'view=withdrawals&withdrawalStatus=REQUESTED&page=1',
    },
    {
      label: '출금 결과 대기',
      count: overview.settlementPending,
      query: 'view=withdrawals&withdrawalStatus=PROCESSING&page=1',
    },
    {
      label: '출금 실패',
      count: overview.withdrawalFailed,
      query: 'view=withdrawals&withdrawalStatus=FAILED&page=1',
      accent: true,
    },
  ];

  const handleClick = (query: string) => {
    router.replace(`${pathname}?${query}`);
  };

  return (
    <div className="flex flex-wrap gap-3 py-3">
      {cards.map((card) => (
        <button
          key={card.label}
          type="button"
          onClick={() => handleClick(card.query)}
          className={[
            'flex min-w-[140px] flex-col gap-1 rounded-lg border px-4 py-3 text-left transition-colors',
            card.accent
              ? 'border-destructive/30 bg-destructive/5 hover:bg-destructive/10'
              : 'border-border bg-card hover:bg-muted/60',
          ].join(' ')}
        >
          <span className="text-xs text-muted-foreground">{card.label}</span>
          <span
            className={[
              'text-2xl font-bold',
              card.accent ? 'text-destructive' : 'text-foreground',
            ].join(' ')}
          >
            {card.count.toLocaleString()}
          </span>
        </button>
      ))}
    </div>
  );
}
