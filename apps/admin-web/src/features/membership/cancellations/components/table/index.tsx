'use client';

import { useState, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { createColumnHelper } from '@tanstack/react-table';
import { useMembershipMembers } from '@/lib/services/membership';
import { useMemberUserSearch } from '@/hooks/use-member-user-search';
import { useMembershipMemberTableQuery } from '@/hooks/table/query/use-membership-member-table-query';
import { useDataTable } from '@/hooks/use-data-table';
import { DataTable } from '@/components/data-table';
import { AdminMemberListItem } from '@/lib/api/domains/membership';
import { MembershipMemberDetailDialog } from '@/features/membership/members/components/detail-dialog';
import { useUserNames, UserInfo } from '@/hooks/use-user-names';
import Link from 'next/link';

const PAGE_SIZE = 20;

const columnHelper = createColumnHelper<AdminMemberListItem>();

function getPlanLabel(durationDays: number): string {
  if (durationDays >= 365) return '연간';
  if (durationDays >= 28) return '월간';
  return `${durationDays}일`;
}

/**
 * 해지 유형 — 즉시 종료 / 잔여기간 이용 중 / 예약 후 실제 종료는 CS 대응이 각각 다르다.
 *
 * 근거(cancelledAt·recurringCancelledAt)가 없으면 아무 유형도 단정하지 않는다. 옛 서버 응답이나
 * 필터가 어긋난 경우에 '해지 예약' 으로 보이면 해지하지도 않은 회원이 해지자로 읽힌다.
 */
function getCancelKind(
  row: AdminMemberListItem
): { label: string; className: string } | null {
  if (row.status === 'CANCELLED') {
    return { label: '즉시 해지', className: 'bg-red-50 text-red-700 border-red-200' };
  }
  if (!row.recurringCancelledAt) return null;
  if (row.status === 'EXPIRED') {
    return { label: '해지 완료', className: 'bg-gray-100 text-gray-700 border-gray-300' };
  }
  return { label: '해지 예약', className: 'bg-amber-50 text-amber-800 border-amber-200' };
}

/** 해지를 신청한 시각. 예약 해지는 cancelledAt 이 비어 있고 recurringCancelledAt 에 있다. */
function getCancelledAt(row: AdminMemberListItem): string | null {
  return row.cancelledAt ?? row.recurringCancelledAt ?? null;
}

/**
 * 환불 상태 — 돈이 나갔는지가 한눈에 보여야 한다.
 * 과도기(membership 이 옛 버전)엔 필드가 undefined 라 아무것도 단정하지 않는다.
 */
function getRefundState(row: AdminMemberListItem): { label: string; className: string } | null {
  if (row.refundRequested === undefined) return null;
  if (!row.refundRequested) {
    return { label: '환불 없음', className: 'text-muted-foreground' };
  }
  if (row.refundCompleted) {
    return { label: '완료', className: 'text-emerald-700' };
  }
  if (row.hasPaymentIntent === false) {
    // 결제 이력이 없는 계약(관리자 지급·이관)에 환불 요청만 남은 건 — 보낼 곳도 근거도 없다.
    return { label: '대상 결제 없음', className: 'text-muted-foreground' };
  }
  return { label: '미완료 — 처리 필요', className: 'font-semibold text-amber-700' };
}

const CANCEL_REASON_LABELS: Record<string, string> = {
  ADMIN_FORCED: '관리자 강제취소',
  PAYMENT_FAILURE_MAX_ATTEMPTS: '결제 실패(재시도 초과)',
  BILLING_AGREEMENT_NOT_FOUND: '결제수단 없음',
  BILLING_METHOD_NOT_ACTIVE: '결제수단 비활성',
};

function getCancelReasonLabel(row: AdminMemberListItem): string {
  // 1순위: 백엔드가 마스터 테이블에서 해석한 표시 텍스트(고객 자율 취소 사유 포함),
  // 2순위: 시스템 코드 정적 라벨, 3순위: 원본 코드.
  const code = row.cancellationReasonCode ?? row.recurringCancellationReasonCode;
  if (row.cancellationReasonText) return row.cancellationReasonText;
  if (!code) return '-';
  return CANCEL_REASON_LABELS[code] ?? code;
}

function useColumns(onEdit?: (row: AdminMemberListItem) => void, userMap: Record<string, UserInfo> = {}) {
  return useMemo(
    () => [
      columnHelper.accessor('userId', {
        header: '로그인 아이디',
        cell: ({ getValue }) => {
          const userId = getValue();
          const loginId = userMap[userId]?.loginId;
          return (
            <Link
              href={`/customer-window/${userId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary text-xs hover:underline"
            >
              {loginId || userId}
            </Link>
          );
        },
      }),
      columnHelper.display({
        id: 'name',
        header: '성명',
        cell: ({ row }) => (
          <span className="text-sm">
            {userMap[row.original.userId]?.username ?? <span className="text-muted-foreground">-</span>}
          </span>
        ),
      }),
      columnHelper.accessor('tierCode', {
        header: '플랜',
        cell: ({ getValue, row }) => (
          <span className="text-sm">
            {getValue()} ({getPlanLabel(row.original.planDurationDays)})
          </span>
        ),
      }),
      columnHelper.accessor('createdAt', {
        header: '구독 시작일',
        cell: ({ getValue }) => (
          <span className="text-sm">{new Date(getValue()).toLocaleDateString('ko-KR')}</span>
        ),
      }),
      columnHelper.display({
        id: 'cancelKind',
        header: '해지 유형',
        cell: ({ row }) => {
          const kind = getCancelKind(row.original);
          if (!kind) return <span className="text-sm text-muted-foreground">-</span>;
          return (
            <span className={`rounded border px-1.5 py-0.5 text-xs ${kind.className}`}>
              {kind.label}
            </span>
          );
        },
      }),
      columnHelper.accessor('cancelledAt', {
        header: '해지 신청일시',
        cell: ({ row }) => {
          const v = getCancelledAt(row.original);
          // 같은 날 여러 건이 들어오면 순서를 알 수 없다 — 분 단위까지 보여준다.
          return (
            <span className="text-sm whitespace-nowrap">
              {v
                ? new Date(v).toLocaleString('ko-KR', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : '-'}
            </span>
          );
        },
      }),
      columnHelper.display({
        id: 'refund',
        header: '환불',
        cell: ({ row }) => {
          const state = getRefundState(row.original);
          if (!state) return <span className="text-sm text-muted-foreground">-</span>;
          const amount = row.original.eligibleRefundAmount ?? 0;
          return (
            <span className={`text-sm ${state.className}`}>
              {row.original.refundRequested && amount > 0
                ? `${amount.toLocaleString()}원 · ${state.label}`
                : state.label}
            </span>
          );
        },
      }),
      columnHelper.display({
        id: 'endsAt',
        header: '이용 종료일',
        cell: ({ row }) => (
          <span className="text-sm">
            {row.original.endsAt
              ? new Date(row.original.endsAt).toLocaleDateString('ko-KR')
              : '-'}
          </span>
        ),
      }),
      columnHelper.accessor('cancellationReasonCode', {
        id: 'cancelReason',
        header: '해지 사유',
        cell: ({ row }) => <span className="text-sm">{getCancelReasonLabel(row.original)}</span>,
      }),
      columnHelper.display({
        id: 'actions',
        header: '관리',
        cell: ({ row }) => (
          <button
            className="text-xs text-primary underline"
            onClick={() => onEdit?.(row.original)}
          >
            상세보기
          </button>
        ),
      }),
    ],
    [onEdit, userMap],
  );
}

export function CancellationsTable() {
  const [selectedMember, setSelectedMember] = useState<AdminMemberListItem | null>(null);

  const { searchParams: query, memberQ } = useMembershipMemberTableQuery({ pageSize: PAGE_SIZE });
  const { resolvedUserIds, isSearchingUsers } = useMemberUserSearch(memberQ);

  // 해지 내역은 즉시해지(CANCELLED)와 예약해지(잔여기간 이용 중)를 함께 봐야 한다 —
  // CANCELLED 만 보면 고객이 해지 신청한 건이 목록에서 통째로 빠진다.
  const searchParams = useSearchParams();
  const cancelKind = searchParams.get('cancelKind') ?? 'ALL';
  const status =
    cancelKind === 'IMMEDIATE'
      ? 'CANCELLED'
      : cancelKind === 'SCHEDULED'
        ? 'RECURRING_CANCELLED'
        : cancelKind === 'ENDED'
          ? 'RECURRING_CANCELLED_ENDED'
          : 'CANCELLED_ANY';
  const refundPending = searchParams.get('refundPending') === 'true' ? true : undefined;

  const membershipQuery = memberQ && resolvedUserIds !== null
    ? { ...query, q: undefined, userIds: resolvedUserIds, status, refundPending }
    : { ...query, status, refundPending };

  const { data, isLoading, isFetching } = useMembershipMembers(membershipQuery, {
    enabled: !memberQ || (Array.isArray(resolvedUserIds) && resolvedUserIds.length > 0),
  });

  const userIds = useMemo(() => data?.data.map((m) => m.userId) ?? [], [data?.data]);
  const userMap = useUserNames(userIds);
  const columns = useColumns(setSelectedMember, userMap);

  const { table } = useDataTable({
    data: data?.data ?? [],
    columns,
    count: data?.total,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.contractId,
  });

  return (
    <>
      <DataTable
        table={table}
        isLoading={isLoading || (!!memberQ && isSearchingUsers)}
        isFetching={isFetching}
        count={data?.total ?? 0}
        pageSize={PAGE_SIZE}
        noRecords={{ message: '해지 내역이 없습니다.' }}
      />
      <MembershipMemberDetailDialog
        member={selectedMember}
        open={!!selectedMember}
        onClose={() => setSelectedMember(null)}
      />
    </>
  );
}
