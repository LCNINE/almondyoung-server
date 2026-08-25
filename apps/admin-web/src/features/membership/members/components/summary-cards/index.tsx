'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useMembershipMembersSummary } from '@/lib/services/membership';

type CardConfig = {
  label: string;
  count: number;
  /** 클릭 시 이동할 목록 필터. 카드 숫자와 목록 total 은 서버에서 같은 쿼리로 계산된다. */
  query: string;
  hint?: string;
};

export function MembershipMembersSummaryCards() {
  const router = useRouter();
  const pathname = usePathname();
  const { data: summary, isError } = useMembershipMembersSummary();

  // 요약 실패가 목록 화면을 막으면 안 된다 — 카드만 조용히 숨긴다.
  if (isError || !summary) return null;

  const cards: CardConfig[] = [
    { label: '전체 회원', count: summary.total, query: 'page=1', hint: '한 번이라도 구독했던 회원' },
    { label: '활성', count: summary.active, query: 'status=ACTIVE&page=1', hint: '해지 예약 포함' },
    { label: '해지 예약', count: summary.recurringCancelled, query: 'status=RECURRING_CANCELLED&page=1', hint: '잔여기간 이용 중' },
    { label: '일시정지', count: summary.paused, query: 'status=PAUSED&page=1' },
    { label: '만료', count: summary.expired, query: 'status=EXPIRED&page=1' },
    { label: '해지', count: summary.cancelled, query: 'status=CANCELLED&page=1' },
  ];

  return (
    <div className="mb-4 flex flex-wrap gap-3">
      {cards.map((card) => (
        <button
          key={card.label}
          type="button"
          onClick={() => router.replace(`${pathname}?${card.query}`)}
          className="flex min-w-[140px] flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/60"
        >
          <span className="text-xs text-muted-foreground">{card.label}</span>
          <span className="text-2xl font-bold text-foreground">{card.count.toLocaleString()}</span>
          {card.hint && <span className="text-[11px] text-muted-foreground">{card.hint}</span>}
        </button>
      ))}
    </div>
  );
}
