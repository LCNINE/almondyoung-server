'use client';

import type { PointsBalanceDto } from '@/lib/types/dto/wallet';

export function PointsBalanceCards({ balance }: { balance: PointsBalanceDto | undefined }) {
  if (!balance) return null;

  const cards = [
    { label: '확정', value: balance.confirmed },
    { label: '예약', value: balance.reserved },
    { label: '사용가능', value: balance.available, highlight: true },
  ];

  return (
    <div className="grid grid-cols-3 gap-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="shadow-[0px_0px_0px_2px_rgba(0,0,0,0.12)] rounded-lg p-4"
        >
          <p className="text-sm font-medium text-muted-foreground">{card.label}</p>
          <p className={`text-2xl font-bold mt-1 ${card.highlight ? 'text-primary' : ''}`}>
            {card.value.toLocaleString('ko-KR')}
          </p>
        </div>
      ))}
    </div>
  );
}
