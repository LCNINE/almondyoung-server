'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { QuickActionsCard } from '@/features/main/quick-actions/QuickActionsCard';
import { useBusinessLicenses } from '@/lib/services/business-licenses';
import { useMembershipMembersSummary } from '@/lib/services/membership';
import { useOrderStats, useSalesOrders } from '@/lib/services/orders';
import { useQuestions } from '@/lib/services/qna';
import { useReviews } from '@/lib/services/review';
import { useExchangeRequests, useReturnRequests } from '@/lib/services/return-exchange/queries';
import { useKeywordStatistics, useZeroHitKeywords } from '@/lib/services/search';
import { useAllUserCount } from '@/lib/services/users';
import { usePendingBankTransfers, useRefundRequests } from '@/lib/services/wallet';
import { toLocalDateString } from '@/lib/utils/date';
import { cn } from '@/lib/utils/ui';
import type { SalesOrderStatus } from '@/lib/types/dto/orders';
import { ZeroHitTable, useAssigneeOptions } from '@/features/keyword-ops/components/ZeroHitTable';
import { DiagnosisLines } from '@/features/keyword-ops/components/summary';
import { buildKeywordDiagnosis } from '@/features/keyword-ops/diagnosis';
import { formatKinds, formatTimes } from '@/features/keyword-ops/labels';
import { ChevronRight, Package } from 'lucide-react';

/** 메인은 기간 선택기를 두지 않는다 — 기간을 바꿔 보려면 통계 탭으로 간다. */
const MAIN_RANGE_DAYS = 7;
/** 현황판 표는 훑어보는 자리다. 전체 목록은 각 탭의 "전체 보기"로 넘긴다. */
const BOARD_ROWS = 10;

const STATUS_LABEL: Record<SalesOrderStatus, string> = {
  pending: '대기',
  confirmed: '확인',
  processing: '처리중',
  shipped: '배송중',
  delivered: '완료',
  cancelled: '취소',
  timeout: '타임아웃',
};

const STATUS_COLOR: Record<SalesOrderStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  confirmed: 'bg-blue-100 text-blue-700',
  processing: 'bg-blue-100 text-blue-700',
  shipped: 'bg-violet-100 text-violet-700',
  delivered: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-600',
  timeout: 'bg-gray-100 text-gray-600',
};

function lastDays(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (days - 1));
  return { from: toLocalDateString(from), to: toLocalDateString(to) };
}

const BOARD_TABS = [
  { id: 'sourcing', label: '소싱 후보 (검색 0건)' },
  { id: 'keywords', label: '인기 검색어' },
  { id: 'orders', label: '주문처리 현황' },
  { id: 'members', label: '회원/멤버십' },
  { id: 'cs', label: 'CS 현황' },
] as const;

type BoardTabId = (typeof BOARD_TABS)[number]['id'];

export default function MainTemplate() {
  const [tab, setTab] = useState<BoardTabId>('sourcing');
  const range = lastDays(MAIN_RANGE_DAYS);

  // ─── 오늘의 할 일 — 처리 대기 큐를 건수만 센다 (count 전용 limit 1) ───
  const orderStats = useOrderStats();
  const bankTransfers = usePendingBankTransfers(1, 1);
  const refundRequests = useRefundRequests(1, 1);
  const returnRequests = useReturnRequests({ status: 'requested', page: 1, limit: 1 });
  const exchangeRequests = useExchangeRequests({ status: 'requested', page: 1, limit: 1 });
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

  const returnExchangeCount =
    returnRequests.data == null && exchangeRequests.data == null
      ? undefined
      : (returnRequests.data?.total ?? 0) + (exchangeRequests.data?.total ?? 0);

  const chips = [
    {
      id: 'bank-transfers',
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
      label: '매칭 대기',
      hint: '출고 막힘 · 14일',
      count: orderStats.data?.waitingMatching,
      href: '/order/matching',
      isLoading: orderStats.isLoading,
      isError: orderStats.isError,
    },
    {
      id: 'outbound-requested',
      label: '출고 요청',
      count: orderStats.data?.outboundRequested,
      href: '/order/fulfillments',
      isLoading: orderStats.isLoading,
      isError: orderStats.isError,
    },
    {
      id: 'cannot-ship',
      label: '출고 불가',
      count: orderStats.data?.cannotShip,
      href: '/order/fulfillments',
      isLoading: orderStats.isLoading,
      isError: orderStats.isError,
    },
    {
      id: 'return-exchange',
      label: '반품·교환',
      count: returnExchangeCount,
      href: '/cs/return-exchange',
      isLoading: returnRequests.isLoading || exchangeRequests.isLoading,
      isError: returnRequests.isError || exchangeRequests.isError,
    },
    {
      id: 'refund-requests',
      label: '환불 신청',
      count: refundRequests.data?.total,
      href: '/payments/refund-requests',
      isLoading: refundRequests.isLoading,
      isError: refundRequests.isError,
    },
    {
      id: 'unanswered-qna',
      label: '미답변 문의',
      count: unansweredQna.data?.total,
      href: '/cs/qna',
      isLoading: unansweredQna.isLoading,
      isError: unansweredQna.isError,
    },
    {
      id: 'unanswered-reviews',
      label: '미답변 리뷰',
      hint: '자체 작성분',
      count: unansweredOwnReviews.data?.total,
      href: '/cs/reviews',
      isLoading: unansweredOwnReviews.isLoading,
      isError: unansweredOwnReviews.isError,
    },
    {
      id: 'business-licenses',
      label: '사업자 심사',
      count: businessLicenses.data?.total,
      href: '/cs/business-licenses?status=under_review',
      isLoading: businessLicenses.isLoading,
      isError: businessLicenses.isError,
    },
    {
      id: 'neglected-keywords',
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
      <div>
        <h1 className="text-3xl font-bold text-gray-900">대시보드</h1>
        <p className="mt-1 text-sm text-gray-500">LCNINE 관리자 시스템</p>
      </div>

      <Card className="border border-gray-200 bg-white shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-baseline gap-2">
            <CardTitle className="text-base text-gray-900">오늘의 할 일</CardTitle>
            <span className="text-xs text-gray-400">{todayLabel}</span>
          </div>
          <CardDescription className="text-xs text-gray-500">
            처리를 기다리는 건수입니다. 0이면 할 일이 없다는 뜻이고, 숫자를 누르면 해당 목록으로 갑니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {chips.map((chip) => (
              <TodoChip key={chip.id} {...chip} />
            ))}
          </div>
        </CardContent>
      </Card>

      <QuickActionsCard />

      <Card className="border border-gray-200 bg-white shadow-sm">
        <CardHeader className="pb-0">
          <div className="flex flex-wrap gap-1 border-b border-gray-200">
            {BOARD_TABS.map((boardTab) => (
              <button
                key={boardTab.id}
                type="button"
                onClick={() => setTab(boardTab.id)}
                aria-current={tab === boardTab.id ? 'page' : undefined}
                className={cn(
                  '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                  tab === boardTab.id
                    ? 'border-gray-900 text-gray-900'
                    : 'border-transparent text-gray-500 hover:text-gray-700',
                )}
              >
                {boardTab.label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          {/* 선택된 탭만 그린다 — 안 보는 탭의 요청까지 로그인 직후에 한꺼번에 나가지 않도록 */}
          {tab === 'sourcing' ? <SourcingBoard range={range} /> : null}
          {tab === 'keywords' ? <PopularKeywordsBoard range={range} /> : null}
          {tab === 'orders' ? <OrdersBoard /> : null}
          {tab === 'members' ? <MembersBoard /> : null}
          {tab === 'cs' ? <CsBoard /> : null}
        </CardContent>
      </Card>
    </div>
  );
}

function TodoChip({
  label,
  hint,
  count,
  href,
  onClick,
  isLoading,
  isError,
}: {
  label: string;
  hint?: string;
  count: number | undefined;
  href?: string;
  onClick?: () => void;
  isLoading?: boolean;
  isError?: boolean;
}) {
  const isPending = count != null && count > 0;
  const body = (
    <>
      <span className="text-xs text-gray-500">
        {label}
        {hint ? <span className="ml-1 text-[10px] text-gray-400">{hint}</span> : null}
      </span>
      {isLoading ? (
        <Skeleton className="mt-0.5 h-6 w-10" />
      ) : isError ? (
        <span className="mt-0.5 text-sm text-gray-400">불러오지 못함</span>
      ) : (
        <span
          className={cn(
            'mt-0.5 text-xl font-bold tabular-nums',
            isPending ? 'text-red-600' : 'text-gray-400',
          )}
        >
          {count ?? '-'}
        </span>
      )}
    </>
  );

  const className = cn(
    'flex min-w-28 flex-col rounded-lg border px-3 py-2 text-left transition-colors',
    isPending ? 'border-red-200 bg-red-50 hover:border-red-300' : 'border-gray-200 bg-white hover:border-gray-300',
  );

  if (href) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {body}
    </button>
  );
}

function BoardHeader({ children, href, linkLabel }: { children: React.ReactNode; href: string; linkLabel: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
      <div className="text-xs text-gray-500">{children}</div>
      <Link href={href} className="flex shrink-0 items-center gap-0.5 text-xs text-blue-600 hover:underline">
        {linkLabel} <ChevronRight className="h-3 w-3" />
      </Link>
    </div>
  );
}

/**
 * 기본 탭 — 고객이 찾았는데 결과를 못 준 검색어.
 * 매출은 /statistics/overview 에 있어 메인에 중복으로 두지 않는다.
 */
function SourcingBoard({ range }: { range: { from: string; to: string } }) {
  const zeroHit = useZeroHitKeywords({
    from: range.from,
    to: range.to,
    page: 1,
    limit: BOARD_ROWS,
    status: 'open',
  });
  const assigneeOptions = useAssigneeOptions();
  const summary = zeroHit.data?.summary;
  const sentences = buildKeywordDiagnosis({
    totalSearches: undefined,
    zeroResultSearches: undefined,
    summary,
    rangeDays: MAIN_RANGE_DAYS,
  });

  if (zeroHit.isError) {
    return <p className="py-6 text-center text-xs text-red-500">0건 검색어를 불러오지 못했습니다.</p>;
  }

  return (
    <div className="space-y-3">
      <BoardHeader href="/statistics/keywords" linkLabel="전체 보기">
        최근 {MAIN_RANGE_DAYS}일 · 아직 처리하지 않은 것만 · 방치가 오래된 순
      </BoardHeader>
      <DiagnosisLines sentences={sentences} isLoading={zeroHit.isLoading} />
      {zeroHit.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <ZeroHitTable
          rows={zeroHit.data?.items ?? []}
          assigneeOptions={assigneeOptions}
          showMemo={false}
          emptyText="처리를 기다리는 0건 검색어가 없습니다"
        />
      )}
      {summary && summary.zeroKeywordCount > BOARD_ROWS ? (
        <p className="text-[11px] text-gray-400">
          미해결 {formatKinds(summary.zeroKeywordCount)} 중 방치가 오래된 {BOARD_ROWS}개만 보여줍니다.
        </p>
      ) : null}
    </div>
  );
}

function PopularKeywordsBoard({ range }: { range: { from: string; to: string } }) {
  const { data, isLoading, isError } = useKeywordStatistics({ from: range.from, to: range.to, limit: BOARD_ROWS });

  if (isError) {
    return <p className="py-6 text-center text-xs text-red-500">인기 검색어를 불러오지 못했습니다.</p>;
  }
  if (isLoading) return <Skeleton className="h-40 w-full" />;

  const rows = data?.top ?? [];
  return (
    <div>
      <BoardHeader href="/statistics/keywords" linkLabel="전체 보기">
        최근 {MAIN_RANGE_DAYS}일 · 증감은 직전 {MAIN_RANGE_DAYS}일 대비
      </BoardHeader>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-gray-400">조회 기간에 검색 기록이 없습니다</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-gray-500">
              <th className="py-1.5 text-left">#</th>
              <th className="py-1.5 text-left">검색어</th>
              <th className="py-1.5 text-right">검색 수</th>
              <th className="py-1.5 text-right">그중 빈손</th>
              <th className="py-1.5 text-right">직전 기간</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.keywordNorm} className="border-b last:border-0">
                <td className="py-1.5 text-gray-400">{index + 1}</td>
                <td className="py-1.5 font-medium text-gray-900">{row.keyword}</td>
                <td className="py-1.5 text-right tabular-nums">{formatTimes(row.count)}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {row.zeroCount > 0 ? (
                    <span className="text-red-600">{formatTimes(row.zeroCount)}</span>
                  ) : (
                    <span className="text-gray-400">0회</span>
                  )}
                </td>
                <td className="py-1.5 text-right tabular-nums text-gray-500">{formatTimes(row.previousCount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function OrdersBoard() {
  const { data, isLoading, isError } = useSalesOrders({ limit: 5 });
  const orderStats = useOrderStats();

  const orders = data?.data ?? [];
  return (
    <div className="space-y-3">
      <BoardHeader href="/order/history" linkLabel="전체 보기">
        오늘 주문 {orderStats.data?.todayCount ?? '-'}건 · 최근 접수된 5건
      </BoardHeader>
      {isError ? (
        <p className="py-6 text-center text-xs text-red-500">주문을 불러오지 못했습니다.</p>
      ) : isLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <p className="py-6 text-center text-xs text-gray-400">주문이 없습니다</p>
      ) : (
        <div className="space-y-2">
          {orders.map((order) => (
            <div
              key={order.id}
              className="flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors hover:bg-gray-50"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="shrink-0 rounded-md bg-blue-50 p-1.5">
                  <Package className="h-3.5 w-3.5 text-blue-600" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">{order.channelOrderId}</p>
                  <p className="truncate text-xs text-gray-400">{order.customerName ?? '-'}</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <p className="text-sm font-medium tabular-nums text-gray-900">
                  {order.totalAmount != null ? `₩${order.totalAmount.toLocaleString('ko-KR')}` : '-'}
                </p>
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                    STATUS_COLOR[order.status],
                  )}
                >
                  {STATUS_LABEL[order.status]}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MembersBoard() {
  const userCount = useAllUserCount();
  const members = useMembershipMembersSummary();

  return (
    <div className="space-y-3">
      <BoardHeader href="/membership/members?status=ACTIVE&page=1" linkLabel="멤버십 회원 보기">
        누적 기준 · 멤버십 활성은 목록의 ACTIVE 필터와 같은 기준(해지 예약 포함, 일시정지 제외)
      </BoardHeader>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <BoardStat label="전체 회원" value={userCount.data} unit="명" isLoading={userCount.isLoading} isError={userCount.isError} />
        <BoardStat
          label="멤버십 활성 회원"
          value={members.data?.active}
          unit="명"
          isLoading={members.isLoading}
          isError={members.isError}
        />
      </div>
    </div>
  );
}

function CsBoard() {
  const unansweredQna = useQuestions({ status: 'active', page: 1, limit: 1 });
  const ownReviews = useReviews({ hasComment: 'false', status: 'active', source: 'own', page: 1, limit: 1 });
  const legacyReviews = useReviews({ hasComment: 'false', status: 'active', source: 'legacy', page: 1, limit: 1 });
  const returnRequests = useReturnRequests({ status: 'requested', page: 1, limit: 1 });
  const exchangeRequests = useExchangeRequests({ status: 'requested', page: 1, limit: 1 });
  const businessLicenses = useBusinessLicenses({ limit: 10, status: 'under_review' });

  return (
    <div className="space-y-3">
      <BoardHeader href="/cs/qna" linkLabel="문의 보기">
        접수되어 처리를 기다리는 건수입니다
      </BoardHeader>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <BoardStat
          label="미답변 문의"
          value={unansweredQna.data?.total}
          unit="건"
          isLoading={unansweredQna.isLoading}
          isError={unansweredQna.isError}
        />
        <BoardStat
          label="미답변 리뷰 (자체 작성)"
          value={ownReviews.data?.total}
          unit="건"
          isLoading={ownReviews.isLoading}
          isError={ownReviews.isError}
        />
        <BoardStat
          label="미답변 리뷰 (이전 사이트 이관분)"
          value={legacyReviews.data?.total}
          unit="건"
          hint="기간 제한 없는 누적 백로그"
          isLoading={legacyReviews.isLoading}
          isError={legacyReviews.isError}
        />
        <BoardStat
          label="반품 접수"
          value={returnRequests.data?.total}
          unit="건"
          isLoading={returnRequests.isLoading}
          isError={returnRequests.isError}
        />
        <BoardStat
          label="교환 접수"
          value={exchangeRequests.data?.total}
          unit="건"
          isLoading={exchangeRequests.isLoading}
          isError={exchangeRequests.isError}
        />
        <BoardStat
          label="사업자 심사 대기"
          value={businessLicenses.data?.total}
          unit="건"
          isLoading={businessLicenses.isLoading}
          isError={businessLicenses.isError}
        />
      </div>
    </div>
  );
}

function BoardStat({
  label,
  value,
  unit,
  hint,
  isLoading,
  isError,
}: {
  label: string;
  value: number | undefined;
  unit: string;
  hint?: string;
  isLoading?: boolean;
  isError?: boolean;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      {isLoading ? (
        <Skeleton className="mt-1 h-7 w-20" />
      ) : isError ? (
        <p className="mt-1 text-sm text-gray-400">불러오지 못함</p>
      ) : (
        <p className="mt-1 text-xl font-bold tabular-nums text-gray-900">
          {value != null ? `${value.toLocaleString('ko-KR')}${unit}` : '-'}
        </p>
      )}
      {hint ? <p className="mt-1 text-[11px] text-gray-400">{hint}</p> : null}
    </div>
  );
}
