'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useMembershipMembersSummary } from '@/lib/services/membership';
import { cn } from '@/lib/utils/ui';

type ChipConfig = {
  label: string;
  count: number;
  /** 목록의 status 필터 값. 칩 숫자와 목록 total 은 서버에서 같은 쿼리로 계산된다. */
  status: string;
  hint?: string;
};

/**
 * 상태별 회원 수 — 한 줄짜리 칩. 위의 «지금 상황» 카드가 사람 축을 맡으므로 여기는 레코드 상태만
 * 가볍게 둔다. 누르면 그 상태의 전체 명단(사람 축은 풀린다).
 */
export function MembershipMembersSummaryCards() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: summary, isError } = useMembershipMembersSummary();

  // 요약 실패가 목록 화면을 막으면 안 된다 — 칩만 조용히 숨긴다.
  if (isError || !summary) return null;

  const axisActive = !!searchParams.get('axis');
  const currentStatus = axisActive ? null : (searchParams.get('status') ?? '');

  const chips: ChipConfig[] = [
    { label: '전체', count: summary.total, status: '', hint: '한 번이라도 구독했던 회원' },
    { label: '활성', count: summary.active, status: 'ACTIVE', hint: '해지 예약 포함' },
    { label: '해지 예약', count: summary.recurringCancelled, status: 'RECURRING_CANCELLED', hint: '잔여기간 이용 중' },
    { label: '일시정지', count: summary.paused, status: 'PAUSED' },
    { label: '만료', count: summary.expired, status: 'EXPIRED' },
    { label: '해지', count: summary.cancelled, status: 'CANCELLED' },
  ];

  return (
    <nav aria-label="상태로 보기" className="mb-4 flex flex-wrap items-center gap-2">
      <span className="mr-1 text-xs font-medium text-gray-500">상태로 보기</span>
      {chips.map((chip) => {
        const active = currentStatus === chip.status;
        return (
          <button
            key={chip.label}
            type="button"
            title={chip.hint}
            aria-pressed={active}
            onClick={() => router.replace(`${pathname}?${chip.status ? `status=${chip.status}&` : ''}page=1`)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-1',
              active
                ? 'border-gray-900 bg-gray-900 text-white'
                : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
            )}
          >
            {chip.label}
            <span className={cn('tabular-nums', active ? 'text-white/80' : 'text-gray-500')}>
              {chip.count.toLocaleString('ko-KR')}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
