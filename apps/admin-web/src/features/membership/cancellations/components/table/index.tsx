'use client';

import { useState, useMemo } from 'react';
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
      columnHelper.accessor('cancelledAt', {
        header: '해지일',
        cell: ({ getValue }) => {
          const v = getValue();
          return (
            <span className="text-sm">
              {v ? new Date(v).toLocaleDateString('ko-KR') : '-'}
            </span>
          );
        },
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

  const membershipQuery = memberQ && resolvedUserIds !== null
    ? { ...query, q: undefined, userIds: resolvedUserIds, status: 'CANCELLED' as const }
    : { ...query, status: 'CANCELLED' as const };

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
