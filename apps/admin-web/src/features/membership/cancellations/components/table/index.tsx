'use client';

import { useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { useMembershipMembers } from '@/lib/services/membership';
import { useMemberUserSearch } from '@/hooks/use-member-user-search';
import { useMembershipMemberTableQuery } from '@/hooks/table/query/use-membership-member-table-query';
import { useDataTable } from '@/hooks/use-data-table';
import { DataTable } from '@/components/data-table';
import { AdminMemberListItem } from '@/lib/api/domains/membership';
import { MembershipMemberDetailDialog } from '@/features/membership/members/components/detail-dialog';
import Link from 'next/link';

const PAGE_SIZE = 20;

const columnHelper = createColumnHelper<AdminMemberListItem>();

function getPlanLabel(durationDays: number): string {
  if (durationDays >= 365) return '연간';
  if (durationDays >= 28) return '월간';
  return `${durationDays}일`;
}

function useColumns(onEdit?: (row: AdminMemberListItem) => void) {
  return useMemo(
    () => [
      columnHelper.accessor('userId', {
        header: '자사몰 아이디',
        cell: ({ getValue }) => (
          <Link
            href={`/account/customer/${getValue()}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary text-xs hover:underline"
          >
            {getValue()}
          </Link>
        ),
      }),
      columnHelper.display({
        id: 'name',
        header: '성명',
        cell: () => <span className="text-sm text-muted-foreground">-</span>,
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
    [onEdit],
  );
}

export function CancellationsTable() {
  const [selectedMember, setSelectedMember] = useState<AdminMemberListItem | null>(null);

  const { searchParams: query, memberQ } = useMembershipMemberTableQuery({ pageSize: PAGE_SIZE });
  const { resolvedUserIds, isSearchingUsers } = useMemberUserSearch(memberQ);

  const membershipQuery = memberQ && resolvedUserIds !== null
    ? { ...query, q: undefined, userIds: resolvedUserIds, status: 'CANCELLED' }
    : { ...query, status: 'CANCELLED' };

  const { data, isLoading, isFetching } = useMembershipMembers(membershipQuery, {
    enabled: !memberQ || (Array.isArray(resolvedUserIds) && resolvedUserIds.length > 0),
  });

  const columns = useColumns(setSelectedMember);

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
