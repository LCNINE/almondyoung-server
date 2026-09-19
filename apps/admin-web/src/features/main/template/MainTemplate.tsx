'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton';
import { HelpPopover } from '@/features/main/HelpPopover';
import { QuickActionsCard } from '@/features/main/quick-actions/QuickActionsCard';
import { useBusinessLicenses } from '@/lib/services/business-licenses';
import { useOrderStats } from '@/lib/services/orders';
import { useQuestions } from '@/lib/services/qna';
import { useReviews } from '@/lib/services/review';
import { useExchangeRequests, useReturnRequests } from '@/lib/services/return-exchange/queries';
import { CLAIM_IN_PROGRESS } from '@/lib/api/domains/return-exchange';
import { useKeywordStatistics, useZeroHitKeywords } from '@/lib/services/search';
import { usePendingBankTransfers, useRefundRequests } from '@/lib/services/wallet';
import { SalesBoard } from '@/features/main/sales/SalesBoard';
import { RealtimeBoard } from '@/features/main/RealtimeBoard';
import { CsBoard, MembersBoard, OrderStatusBoard, SkeletonRows } from '@/features/main/DailyBoards';
import { SourcingBoard } from '@/features/main/SourcingBoard';
import { BoardHeader } from '@/features/main/BoardHeader';
import { toLocalDateString } from '@/lib/utils/date';
import { cn } from '@/lib/utils/ui';

/** 메인은 기간 선택기를 두지 않는다 — 기간을 바꿔 보려면 통계 탭으로 간다. */
const MAIN_RANGE_DAYS = 7;
/** 현황판 표는 훑어보는 자리다. 전체 목록은 각 탭의 "전체 보기"로 넘긴다. */
const BOARD_ROWS = 10;

function lastDays(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (days - 1));
  return { from: toLocalDateString(from), to: toLocalDateString(to) };
}

const BOARD_TABS = [
  { id: 'sales', label: '오늘의 매출' },
  { id: 'realtime', label: '실시간 접속' },
  { id: 'sourcing', label: '소싱 후보 (고객 검색 0건)' },
  { id: 'keywords', label: '인기 검색어' },
  { id: 'orders', label: '주문처리 현황' },
  { id: 'members', label: '회원/적립금' },
  { id: 'cs', label: 'CS 현황' },
] as const;

type BoardTabId = (typeof BOARD_TABS)[number]['id'];

const CARD_CLASS = 'rounded-2xl bg-white shadow-[0_1px_2px_rgba(0,0,0,0.08),0_0_2px_rgba(0,0,0,0.05)]';

type TodoTone = 'order' | 'claim' | 'etc';

const TODO_TONE: Record<TodoTone, { box: string; count: string }> = {
  order: { box: 'bg-[#F1F9FD]', count: 'text-[#1779BA]' },
  claim: { box: 'bg-[#FEF6F8]', count: 'text-[#D71952]' },
  etc: { box: 'bg-[#FAFAFA]', count: 'text-[#1C1C1C]' },
};

export default function MainTemplate() {
  const [tab, setTab] = useState<BoardTabId>('sales');
  const range = lastDays(MAIN_RANGE_DAYS);

  // ─── 오늘의 할 일 — 처리 대기 큐를 건수만 센다 (count 전용 limit 1) ───
  const orderStats = useOrderStats();
  const bankTransfers = usePendingBankTransfers(1, 1);
  const refundRequests = useRefundRequests(1, 1);
  const returnRequests = useReturnRequests({ status: 'requested', page: 1, limit: 1 });
  const exchangeRequests = useExchangeRequests({ status: 'requested', page: 1, limit: 1 });
  const returnsInProgress = useReturnRequests({ status: CLAIM_IN_PROGRESS, page: 1, limit: 1 });
  const exchangesInProgress = useExchangeRequests({ status: CLAIM_IN_PROGRESS, page: 1, limit: 1 });
  const unansweredQna = useQuestions({ status: 'active', page: 1, limit: 1 });
  // 이전 사이트에서 넘어온 리뷰 백로그는 "오늘 할 일"이 아니다 — 자체 작성분만 센다.
  // 전체(이관분 포함) 건수는 CS 현황 탭에서 따로 보여준다.
  const unansweredOwnReviews = useReviews({
    hasComment: 'false',
    status: 'active',
    source: 'own',
    page: 1,
    limit: 1,
  });
  // limit 은 건수(total)만 쓰지만 user-service 가 최소 10 을 요구한다 (BusinessLicenseQueryDto @Min(10))
  const businessLicenses = useBusinessLicenses({ limit: 10, status: 'under_review' });
  const zeroHit = useZeroHitKeywords({ from: range.from, to: range.to, page: 1, limit: BOARD_ROWS, status: 'open' });

  const chips: (React.ComponentProps<typeof TodoChip> & { id: string })[] = [
    {
      id: 'bank-transfers',
      tone: 'order',
      label: '입금 대기',
      count: bankTransfers.data?.total,
      href: '/payments/bank-transfers',
      isLoading: bankTransfers.isLoading,
      isError: bankTransfers.isError,
    },
    {
      // 매칭 대기는 세는 방식이 여럿이다. 이 칩은 "지금 안 하면 주문이 안 나가는" 것만 센다 —
      // 매칭 화면이 나열하는 주문 라인 수(전 기간)와는 모수가 다르므로 힌트에 밝힌다.
      id: 'waiting-matching',
      tone: 'order',
      label: '매칭 대기',
      hint: '출고 막힘 · 14일',
      count: orderStats.data?.waitingMatching,
      href: '/order/matching',
      isLoading: orderStats.isLoading,
      isError: orderStats.isError,
    },
    {
      id: 'outbound-requested',
      tone: 'order',
      label: '출고 요청',
      count: orderStats.data?.outboundRequested,
      href: '/order/fulfillments',
      isLoading: orderStats.isLoading,
      isError: orderStats.isError,
    },
    {
      id: 'cannot-ship',
      tone: 'order',
      label: '출고 불가',
      count: orderStats.data?.cannotShip,
      href: '/order/fulfillments',
      isLoading: orderStats.isLoading,
      isError: orderStats.isError,
    },
    {
      id: 'exchange-requests',
      tone: 'claim',
      label: '교환신청',
      count: exchangeRequests.data?.total,
      second: {
        label: '처리중',
        href: `/cs/return-exchange?tab=exchanges&status=${encodeURIComponent(CLAIM_IN_PROGRESS)}`,
        count: exchangesInProgress.data?.total,
      },
      href: '/cs/return-exchange?tab=exchanges&status=requested',
      isLoading: exchangeRequests.isLoading || exchangesInProgress.isLoading,
      isError: exchangeRequests.isError || exchangesInProgress.isError,
    },
    {
      id: 'return-requests',
      tone: 'claim',
      label: '반품신청',
      count: returnRequests.data?.total,
      second: {
        label: '처리중',
        href: `/cs/return-exchange?status=${encodeURIComponent(CLAIM_IN_PROGRESS)}`,
        count: returnsInProgress.data?.total,
      },
      href: '/cs/return-exchange?status=requested',
      isLoading: returnRequests.isLoading || returnsInProgress.isLoading,
      isError: returnRequests.isError || returnsInProgress.isError,
    },
    {
      id: 'refund-requests',
      tone: 'etc',
      label: '환불 신청',
      count: refundRequests.data?.total,
      href: '/payments/refund-requests',
      isLoading: refundRequests.isLoading,
      isError: refundRequests.isError,
    },
    {
      id: 'unanswered-qna',
      tone: 'etc',
      label: '미답변 문의',
      count: unansweredQna.data?.total,
      href: '/cs/qna',
      isLoading: unansweredQna.isLoading,
      isError: unansweredQna.isError,
    },
    {
      id: 'unanswered-reviews',
      tone: 'etc',
      label: '미답변 리뷰',
      hint: '자체 작성분',
      count: unansweredOwnReviews.data?.total,
      href: '/cs/reviews',
      isLoading: unansweredOwnReviews.isLoading,
      isError: unansweredOwnReviews.isError,
    },
    {
      id: 'business-licenses',
      tone: 'etc',
      label: '사업자 심사',
      count: businessLicenses.data?.total,
      href: '/cs/business-licenses?status=under_review',
      isLoading: businessLicenses.isLoading,
      isError: businessLicenses.isError,
    },
    {
      id: 'neglected-keywords',
      tone: 'etc',
      label: '방치된 검색어',
      hint: '7일 이상',
      count: zeroHit.data?.summary.openNeglectedOver7Days,
      onClick: () => setTab('sourcing'),
      isLoading: zeroHit.isLoading,
      isError: zeroHit.isError,
    },
  ];

  const today = new Date();
  const todayLabel = today.toLocaleDateString('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });

  return (
    <div className="space-y-6 px-4">
      <section className={CARD_CLASS}>
        <div className="flex items-center gap-2 px-4 pt-3.5 pb-1.5">
          <h2 className="text-base font-bold text-[#1C1C1C]">오늘의 할 일</h2>
          <span className="text-xs text-[#757575]">{todayLabel}</span>
          <HelpPopover
            label="오늘의 할 일"
            items={[
              '오늘 처리해야 할 주문·클레임·CS 건수를 보여줍니다.',
              '각 건수를 클릭하면 해당 목록으로 이동합니다.',
              '0이면 처리할 일이 없다는 뜻입니다.',
              '매칭 대기는 최근 14일 주문 중 출고가 막힌 것, 방치된 검색어는 7일 이상 처리하지 않은 것만 셉니다.',
            ]}
          />
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(80px,1fr))] gap-2 px-4 pb-4">
          {chips.map((chip) => (
            <TodoChip key={chip.id} {...chip} />
          ))}
        </div>
      </section>

      <section className={CARD_CLASS}>
        <div className="mx-4 flex overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_#EBEBEB]">
          {BOARD_TABS.map((boardTab) => (
            <button
              key={boardTab.id}
              type="button"
              onClick={() => setTab(boardTab.id)}
              aria-current={tab === boardTab.id ? 'page' : undefined}
              className={cn(
                'h-12 min-w-[139px] shrink-0 cursor-pointer whitespace-nowrap border-b-4 px-3 text-[15px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1A54F5]/50',
                tab === boardTab.id
                  ? 'border-[#1A54F5] font-bold text-[#1A54F5]'
                  : 'border-transparent font-medium text-[#757575] hover:text-[#1C1C1C]',
              )}
            >
              {boardTab.label}
            </button>
          ))}
        </div>
        <div className="px-4 pt-3 pb-6">
          {/* 선택된 탭만 그린다 — 안 보는 탭의 요청까지 로그인 직후에 한꺼번에 나가지 않도록 */}
          {tab === 'sales' ? <SalesBoard /> : null}
          {tab === 'realtime' ? <RealtimeBoard /> : null}
          {tab === 'sourcing' ? <SourcingBoard range={range} rangeDays={MAIN_RANGE_DAYS} /> : null}
          {tab === 'keywords' ? <PopularKeywordsBoard range={range} /> : null}
          {tab === 'orders' ? <OrderStatusBoard /> : null}
          {tab === 'members' ? <MembersBoard /> : null}
          {tab === 'cs' ? <CsBoard /> : null}
        </div>
      </section>

      <QuickActionsCard />
    </div>
  );
}

function TodoChip({
  label,
  hint,
  tone,
  count,
  second,
  href,
  onClick,
  isLoading,
  isError,
}: {
  label: string;
  hint?: string;
  tone: TodoTone;
  count: number | undefined;
  second?: { label: string; count: number | undefined; href?: string };
  href?: string;
  onClick?: () => void;
  isLoading?: boolean;
  isError?: boolean;
}) {
  const countLink = (value: number | undefined, name: string, target: { href?: string; onClick?: () => void }) => {
    if (isLoading) return <Skeleton className="h-[18px] w-6" />;
    if (isError) return <span className="text-xs leading-[18px] text-gray-400">불러오지 못함</span>;
    const className = cn(
      'cursor-pointer text-[13px] font-bold leading-[18px] tabular-nums underline underline-offset-2',
      TODO_TONE[tone].count,
    );
    const text = value != null ? value.toLocaleString('ko-KR') : '-';
    const ariaLabel = `${name} ${text}건 목록 보기`;
    if (target.href) {
      return (
        <Link href={target.href} aria-label={ariaLabel} className={className}>
          {text}
        </Link>
      );
    }
    return (
      <button type="button" onClick={target.onClick} aria-label={ariaLabel} className={className}>
        {text}
      </button>
    );
  };
  const labelClass = 'whitespace-nowrap text-[13px] font-medium leading-tight text-[#616161]';

  return (
    <div className={cn('flex min-h-[72px] flex-col justify-between rounded-md p-1.5', TODO_TONE[tone].box)}>
      {second ? (
        <>
          <span className="flex items-center justify-between gap-2 py-1">
            <span className={labelClass}>{label}</span>
            {countLink(count, label, { href, onClick })}
          </span>
          <span className="flex items-center justify-between gap-2">
            <span className={labelClass}>{second.label}</span>
            {countLink(second.count, `${label} ${second.label}`, { href: second.href ?? href, onClick })}
          </span>
        </>
      ) : (
        <>
          <span className={cn('py-1', labelClass)}>
            {label}
            {hint ? <span className="block text-[11px] font-normal text-[#9E9E9E]">{hint}</span> : null}
          </span>
          <span>{countLink(count, label, { href, onClick })}</span>
        </>
      )}
    </div>
  );
}

function PopularKeywordsBoard({ range }: { range: { from: string; to: string } }) {
  const { data, isLoading, isError } = useKeywordStatistics({ from: range.from, to: range.to, limit: BOARD_ROWS });

  if (isError) {
    return <p className="py-6 text-center text-xs text-[#D71952]">인기 검색어를 불러오지 못했습니다.</p>;
  }

  const rows = data?.top ?? [];
  return (
    <div className="space-y-3">
      <BoardHeader
        label={`최근 ${MAIN_RANGE_DAYS}일`}
        help={[
          `최근 ${MAIN_RANGE_DAYS}일 동안 많이 검색된 순서입니다.`,
          `직전 대비는 그 앞 ${MAIN_RANGE_DAYS}일과 비교한 증감이고, 그때 검색이 없었으면 신규로 표시합니다.`,
          '결과 없음은 검색 수 중에서 상품이 하나도 안 나온 횟수입니다.',
        ]}
        href="/statistics/keywords"
        linkLabel="전체 보기"
      />
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[#CCCCCC] bg-[#FAFAFA] text-[#616161]">
              <th className="h-[41px] w-14 px-3 text-left font-medium">순위</th>
              <th className="h-[41px] px-3 text-left font-medium">검색어</th>
              <th className="h-[41px] px-3 text-right font-medium">검색 수</th>
              <th className="h-[41px] px-3 text-right font-medium">결과 없음</th>
              <th className="h-[41px] px-3 text-right font-medium">직전 대비</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? <SkeletonRows rows={BOARD_ROWS} cols={4} /> : null}
            {!isLoading && rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-10 text-center text-[#9E9E9E]">
                  조회 기간에 검색 기록이 없습니다
                </td>
              </tr>
            ) : null}
            {rows.map((row, index) => (
              <tr key={row.keywordNorm} className="border-b border-[#EBEBEB]">
                <td className="px-3 py-3 text-sm font-bold tabular-nums text-[#9E9E9E]">{index + 1}</td>
                <td className="px-3 py-3 text-sm font-medium text-[#1C1C1C]">{row.keyword}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right text-sm tabular-nums">
                  <span className="font-bold text-[#2B2B2B]">{row.count.toLocaleString('ko-KR')}</span>
                  <span className="ml-0.5 text-[#757575]">회</span>
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right text-sm tabular-nums">
                  <span className={row.zeroCount > 0 ? 'font-bold text-[#D71952]' : 'text-[#9E9E9E]'}>
                    {row.zeroCount.toLocaleString('ko-KR')}
                  </span>
                  <span className="ml-0.5 text-[#757575]">회</span>
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right text-sm tabular-nums">
                  <KeywordChange current={row.count} previous={row.previousCount} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KeywordChange({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) return <span className="text-[#9E9E9E]">신규</span>;
  const rate = Math.round(((current - previous) / previous) * 100);
  if (rate === 0) return <span className="text-[#9E9E9E]">-</span>;
  return (
    <span className={cn('font-bold', rate > 0 ? 'text-[#D71952]' : 'text-[#1779BA]')}>
      {rate > 0 ? '▲' : '▼'}
      {Math.abs(rate)}%
    </span>
  );
}
