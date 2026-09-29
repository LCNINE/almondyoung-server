'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, CircleCheck, Crown, Hourglass } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { useMemberUserSearch } from '@/hooks/use-member-user-search';
import { useUserNames, UserInfo } from '@/hooks/use-user-names';
import { useMembershipMemberTableQuery } from '@/hooks/table/query/use-membership-member-table-query';
import { useMembersByAxis } from '@/lib/services/membership';
import type {
  AxisMemberRow,
  MemberAxis,
} from '@/lib/api/domains/membership/people';
import { formatDate } from '@/lib/utils/date';
import {
  MembershipMemberDetailDialog,
  MemberDetailTab,
} from '../detail-dialog';
import {
  arrearsCauseShort,
  daysSince,
  daysUntilDate,
  percent,
  planLabel,
  won,
} from './format';

const PAGE_SIZE = 20;

type Ctx = {
  userMap: Record<string, UserInfo>;
  open: (row: AxisMemberRow<MemberAxis>) => void;
};

function PersonCell({ userId, ctx }: { userId: string; ctx: Ctx }) {
  const user = ctx.userMap[userId];
  return (
    <div className="flex flex-col">
      <Link
        href={`/customer-window/${userId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm font-medium text-primary hover:underline"
      >
        {user?.username || user?.loginId || userId}
      </Link>
      {user?.username && (
        <span className="text-xs text-gray-500">{user.loginId}</span>
      )}
    </div>
  );
}

function OpenButton<A extends MemberAxis>({
  row,
  ctx,
  label,
}: {
  row: AxisMemberRow<A>;
  ctx: Ctx;
  label: string;
}) {
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 text-xs"
      onClick={() => ctx.open(row)}
    >
      {label}
    </Button>
  );
}

function person<A extends MemberAxis>(
  ctx: Ctx
): ColumnDef<AxisMemberRow<A>, unknown> {
  return {
    id: 'person',
    header: '회원',
    cell: ({ row }) => <PersonCell userId={row.original.userId} ctx={ctx} />,
  };
}

function arrearsColumns(
  ctx: Ctx
): ColumnDef<AxisMemberRow<'arrears'>, unknown>[] {
  return [
    person(ctx),
    {
      id: 'amount',
      header: '미납 요금',
      cell: ({ row }) => {
        const d = row.original.axisDetail;
        return (
          <div className="flex flex-col">
            <span className="text-sm font-semibold tabular-nums text-gray-900">
              {won(d.outstandingAmount)}
            </span>
            <span className="text-xs text-gray-500">{d.lines}개 주기</span>
          </div>
        );
      },
    },
    {
      id: 'age',
      header: '밀린 지',
      cell: ({ row }) => {
        const days = daysSince(row.original.axisDetail.oldestAt);
        return days >= 30 ? (
          <span className="inline-flex items-center gap-1 text-sm font-medium text-red-600">
            <AlertTriangle className="size-3.5" aria-hidden />
            {days}일째
          </span>
        ) : (
          <span className="text-sm tabular-nums text-gray-700">{days}일째</span>
        );
      },
    },
    {
      id: 'cause',
      header: '생긴 이유',
      cell: ({ row }) => (
        <span className="text-sm text-gray-700">
          {arrearsCauseShort(row.original.axisDetail.causes)}
        </span>
      ),
    },
    {
      id: 'benefit',
      header: '그동안 받은 혜택',
      cell: ({ row }) => {
        const d = row.original.axisDetail;
        const b = d.benefit;
        return (
          <div className="flex flex-col gap-0.5 text-xs">
            {b.discountAmount > 0 ? (
              <span className="text-sm text-gray-900">
                할인 {won(b.discountAmount)}
                <span className="ml-1 text-xs text-gray-500">
                  ({b.discountOrders}건 · 미납액의{' '}
                  {percent(b.discountAmount, d.outstandingAmount)})
                </span>
              </span>
            ) : (
              <span className="text-sm text-gray-500">할인 없음</span>
            )}
            {b.welcomeDeal && (
              <span className="text-amber-700">웰컴딜 구매</span>
            )}
            {b.unmeasuredLines > 0 && (
              <span className="text-gray-500">
                기간을 몰라 못 센 주기 {b.unmeasuredLines}개
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: 'state',
      header: '진행',
      cell: ({ row }) => {
        const d = row.original.axisDetail;
        return (
          <div className="flex flex-col items-start gap-1">
            {d.paymentInProgress ? (
              <Badge variant="secondary" className="gap-1">
                <Hourglass className="size-3" aria-hidden />
                고객이 납부 중
              </Badge>
            ) : (
              <Badge variant="outline">납부 전</Badge>
            )}
            {d.recentMismatches > 0 && (
              <Badge
                variant="outline"
                className="gap-1 border-amber-300 text-amber-800"
              >
                <AlertTriangle className="size-3" aria-hidden />
                납부 금액 불일치 {d.recentMismatches}건
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      id: 'open',
      header: '',
      cell: ({ row }) => (
        <OpenButton row={row.original} ctx={ctx} label="미납 내역" />
      ),
    },
  ];
}

function pastDueColumns(
  ctx: Ctx
): ColumnDef<AxisMemberRow<'past_due'>, unknown>[] {
  return [
    person(ctx),
    {
      id: 'remaining',
      header: '남은 출금 기회',
      cell: ({ row }) => {
        const r = row.original.axisDetail.remainingAttempts;
        return r <= 1 ? (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="size-3" aria-hidden />
            마지막 1번
          </Badge>
        ) : (
          <Badge variant="outline">{r}번 남음</Badge>
        );
      },
    },
    {
      id: 'failed',
      header: '실패',
      cell: ({ row }) => {
        const d = row.original.axisDetail;
        return (
          <div className="flex flex-col">
            <span className="text-sm text-gray-900">
              {d.failedAttempts}번 실패
            </span>
            {d.lastFailedAt && (
              <span className="text-xs text-gray-500">
                마지막 {formatDate(d.lastFailedAt)}
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: 'code',
      header: '사유 코드',
      cell: ({ row }) => (
        <span className="font-mono text-xs text-gray-600">
          {row.original.axisDetail.lastErrorCode ?? '-'}
        </span>
      ),
    },
    {
      id: 'next',
      header: '다음 시도',
      cell: ({ row }) => {
        const d = row.original.axisDetail;
        return d.nextRetryAt ? (
          <span className="text-sm text-gray-700">
            {formatDate(d.nextRetryAt)}
          </span>
        ) : (
          <span className="text-xs text-gray-500">
            결제관리가 영업일 기준으로 정함
          </span>
        );
      },
    },
    {
      id: 'amount',
      header: '한 주기 요금',
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="text-sm tabular-nums text-gray-900">
            {won(row.original.axisDetail.amount)}
          </span>
          <span className="text-xs text-gray-500">
            {row.original.axisDetail.source === 'INVOICE'
              ? '자동이체'
              : '옛 결제 방식'}{' '}
            · {planLabel(row.original.planDurationDays)}
          </span>
        </div>
      ),
    },
    {
      id: 'open',
      header: '',
      cell: ({ row }) => (
        <OpenButton row={row.original} ctx={ctx} label="결제 기록" />
      ),
    },
  ];
}

function goodColumns(ctx: Ctx): ColumnDef<AxisMemberRow<'good'>, unknown>[] {
  return [
    person(ctx),
    {
      id: 'paid',
      header: '낸 멤버십 요금',
      cell: ({ row }) => {
        const d = row.original.axisDetail;
        return (
          <span className="inline-flex items-center gap-1.5">
            <span className="text-sm font-semibold tabular-nums text-gray-900">
              {won(d.paidAmount)}
            </span>
            {d.isTopPayer && (
              <Badge variant="secondary" className="gap-1">
                <Crown className="size-3" aria-hidden />
                결제액 상위
              </Badge>
            )}
          </span>
        );
      },
    },
    {
      id: 'count',
      header: '결제',
      cell: ({ row }) => (
        <span className="text-sm text-gray-700">
          {row.original.axisDetail.paidCount}번 · 산 이용{' '}
          {row.original.axisDetail.paidDays.toLocaleString('ko-KR')}일
        </span>
      ),
    },
    {
      id: 'since',
      header: '함께한 기간',
      cell: ({ row }) => {
        const days = daysSince(row.original.axisDetail.firstPaidAt);
        return (
          <div className="flex flex-col">
            <span className="text-sm text-gray-700">
              {Math.floor(days / 30)}개월째
            </span>
            <span className="text-xs text-gray-500">
              첫 결제 {formatDate(row.original.axisDetail.firstPaidAt)}
            </span>
          </div>
        );
      },
    },
    {
      id: 'status',
      header: '지금',
      cell: ({ row }) =>
        row.original.recurringCancelledAt ? (
          <Badge variant="outline" className="gap-1 text-amber-700">
            <AlertTriangle className="size-3" aria-hidden />
            해지 예약
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1">
            <CircleCheck className="size-3" aria-hidden />
            이용 중
          </Badge>
        ),
    },
    {
      id: 'open',
      header: '',
      cell: ({ row }) => (
        <OpenButton row={row.original} ctx={ctx} label="상세" />
      ),
    },
  ];
}

function endingColumns(
  ctx: Ctx
): ColumnDef<AxisMemberRow<'ending'>, unknown>[] {
  return [
    person(ctx),
    {
      id: 'ends',
      header: '이용 종료',
      cell: ({ row }) => {
        const endsAt = row.original.axisDetail.endsAt;
        if (!endsAt) return <span className="text-sm text-gray-500">-</span>;
        const left = daysUntilDate(endsAt);
        return (
          <div className="flex flex-col">
            <span
              className={
                left <= 7
                  ? 'text-sm font-medium text-red-600'
                  : 'text-sm text-gray-900'
              }
            >
              {left < 0
                ? '종료됨'
                : left === 0
                  ? '오늘 종료'
                  : `${left}일 남음`}
            </span>
            <span className="text-xs text-gray-500">{formatDate(endsAt)}</span>
          </div>
        );
      },
    },
    {
      id: 'reason',
      header: '해지 이유',
      cell: ({ row }) => (
        <span className="text-sm text-gray-700">
          {row.original.cancellation?.reasonLabel ??
            row.original.cancellationReasonText ??
            '사유 미입력'}
        </span>
      ),
    },
    {
      id: 'requested',
      header: '해지 신청',
      cell: ({ row }) => (
        <span className="text-sm text-gray-700">
          {row.original.axisDetail.recurringCancelledAt
            ? formatDate(row.original.axisDetail.recurringCancelledAt)
            : '-'}
        </span>
      ),
    },
    {
      id: 'plan',
      header: '플랜',
      cell: ({ row }) => (
        <span className="text-sm text-gray-700">
          {row.original.tierCode} ({planLabel(row.original.planDurationDays)})
        </span>
      ),
    },
    {
      id: 'open',
      header: '',
      cell: ({ row }) => (
        <OpenButton row={row.original} ctx={ctx} label="상세" />
      ),
    },
  ];
}

const EMPTY_MESSAGE: Record<MemberAxis, string> = {
  arrears:
    '미납 요금이 남은 회원이 없습니다. 출금이 끝내 실패하면 여기에 나타납니다.',
  past_due: '출금 재시도를 기다리는 회원이 없습니다.',
  good: '기준을 모두 넘은 회원이 아직 없습니다. 위 카드의 「판정 기준 보기」를 확인하세요.',
  ending: '해지를 예약한 회원이 없습니다.',
};

const OPEN_TAB: Record<MemberAxis, MemberDetailTab | undefined> = {
  arrears: 'arrears',
  past_due: 'billing',
  good: undefined,
  ending: 'plan',
};

function AxisTableView<A extends MemberAxis>({
  axis,
  buildColumns,
}: {
  axis: A;
  buildColumns: (ctx: Ctx) => ColumnDef<AxisMemberRow<A>, unknown>[];
}) {
  const [selected, setSelected] = useState<AxisMemberRow<MemberAxis> | null>(
    null
  );
  const { searchParams: query, memberQ } = useMembershipMemberTableQuery({
    pageSize: PAGE_SIZE,
  });
  const { resolvedUserIds, isSearchingUsers } = useMemberUserSearch(memberQ);

  // 축 목록은 회원 id 로만 거른다 — 아이디 검색(q)은 그 한 사람으로, 고객 정보 검색은 찾은 사람들로.
  const userIds = memberQ
    ? (resolvedUserIds ?? undefined)
    : query.q
      ? [query.q]
      : undefined;
  // 고객 정보 검색이 아무도 못 찾았으면 묻지 않는다 — 빈 목록을 보내면 서버가 «필터 없음»으로 읽어 축 전체가 나온다.
  const waitingForSearch = !!memberQ && !resolvedUserIds?.length;

  const { data, isLoading, isFetching } = useMembersByAxis(
    axis,
    { page: query.page ?? 1, limit: PAGE_SIZE, userIds },
    { enabled: !waitingForSearch }
  );

  const rows = useMemo(() => data?.data ?? [], [data?.data]);
  const ids = useMemo(() => rows.map((r) => r.userId), [rows]);
  const userMap = useUserNames(ids);
  const columns = useMemo(
    () => buildColumns({ userMap, open: setSelected }),
    [buildColumns, userMap]
  );

  const { table } = useDataTable({
    data: rows,
    columns,
    count: data?.total,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.userId,
  });

  return (
    <>
      <DataTable
        table={table}
        isLoading={isLoading || (!!memberQ && isSearchingUsers)}
        isFetching={isFetching}
        count={data?.total ?? 0}
        pageSize={PAGE_SIZE}
        noRecords={{
          message:
            memberQ || query.q
              ? '검색한 회원 중 해당하는 사람이 없습니다.'
              : EMPTY_MESSAGE[axis],
        }}
      />
      <MembershipMemberDetailDialog
        member={selected}
        open={!!selected}
        onClose={() => setSelected(null)}
        initialTab={OPEN_TAB[axis]}
      />
    </>
  );
}

/** 사람 축 명단. 축마다 «그 사람에게 무슨 일이 있는지»가 한 줄에 읽히도록 열을 바꾼다. */
export function MemberAxisTable({ axis }: { axis: MemberAxis }) {
  switch (axis) {
    case 'arrears':
      return (
        <AxisTableView key={axis} axis={axis} buildColumns={arrearsColumns} />
      );
    case 'past_due':
      return (
        <AxisTableView key={axis} axis={axis} buildColumns={pastDueColumns} />
      );
    case 'good':
      return (
        <AxisTableView key={axis} axis={axis} buildColumns={goodColumns} />
      );
    case 'ending':
      return (
        <AxisTableView key={axis} axis={axis} buildColumns={endingColumns} />
      );
  }
}
