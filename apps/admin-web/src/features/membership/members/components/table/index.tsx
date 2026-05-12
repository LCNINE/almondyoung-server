'use client';

import { useState, useMemo } from 'react';
import { useMembershipMembers } from '@/lib/services/membership';
import { useMemberUserSearch } from '@/hooks/use-member-user-search';
import { useDataTable } from '@/hooks/use-data-table';
import { useMembershipMemberTableColumns } from '@/hooks/table/columns/use-membership-member-table-columns';
import { useMembershipMemberTableQuery } from '@/hooks/table/query/use-membership-member-table-query';
import { DataTable } from '@/components/data-table';
import { AdminMemberListItem } from '@/lib/api/domains/membership';
import { MembershipMemberDetailDialog } from '../detail-dialog';
import { useUserNames } from '@/hooks/use-user-names';

const PAGE_SIZE = 20;

export function MembershipMemberTable() {
  const [selectedMember, setSelectedMember] = useState<AdminMemberListItem | null>(null);

  const { searchParams: query, memberQ } = useMembershipMemberTableQuery({ pageSize: PAGE_SIZE });
  const { resolvedUserIds, isSearchingUsers } = useMemberUserSearch(memberQ);

  const membershipQuery =
    memberQ && resolvedUserIds !== null
      ? { ...query, q: undefined, userIds: resolvedUserIds }
      : query;

  const { data, isLoading, isFetching } = useMembershipMembers(membershipQuery, {
    // disabled when memberQ is set but resolvedUserIds is not yet ready or empty
    enabled: !memberQ || (Array.isArray(resolvedUserIds) && resolvedUserIds.length > 0),
  });

  const userIds = useMemo(() => data?.data.map((m) => m.userId) ?? [], [data?.data]);
  const userMap = useUserNames(userIds);
  const columns = useMembershipMemberTableColumns({ onEdit: setSelectedMember, userMap });

  const { table } = useDataTable({
    data: data?.data ?? [],
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
        noRecords={{ message: '멤버십 회원 데이터가 없습니다.' }}
      />
      <MembershipMemberDetailDialog
        member={selectedMember}
        open={!!selectedMember}
        onClose={() => setSelectedMember(null)}
      />
    </>
  );
}
