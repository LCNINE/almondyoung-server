'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useMembershipMembers } from '@/lib/services/membership';
import { userApi } from '@/lib/api/domains/users';
import { useDataTable } from '@/hooks/use-data-table';
import { useMembershipMemberTableColumns } from '@/hooks/table/columns/use-membership-member-table-columns';
import { useMembershipMemberTableQuery } from '@/hooks/table/query/use-membership-member-table-query';
import { DataTable } from '@/components/data-table';
import { AdminMemberListItem } from '@/lib/api/domains/membership';
import { MembershipMemberDetailDialog } from '../detail-dialog';

const PAGE_SIZE = 20;

export function MembershipMemberTable() {
  const [selectedMember, setSelectedMember] = useState<AdminMemberListItem | null>(null);

  const { searchParams: query, memberQ } = useMembershipMemberTableQuery({ pageSize: PAGE_SIZE });

  // membership service can only filter by exact userIds, not by name/email.
  // When searching by member info, we first resolve matching userIds from user-service.
  const { data: userSearchData, isFetching: isSearchingUsers, isError: isUserSearchError } = useQuery({
    queryKey: ['admin-users-search', memberQ],
    queryFn: () => userApi.getAdminUsers({ q: memberQ, limit: 1000 }),
    enabled: !!memberQ,
    retry: 1,
  });

  useEffect(() => {
    if (isUserSearchError) {
      toast.error('고객 정보 조회에 실패했습니다. 권한을 확인해주세요.');
    }
  }, [isUserSearchError]);

  const resolvedUserIds = memberQ
    ? (userSearchData?.data?.map((u) => u.id) ?? null)
    : undefined;

  const membershipQuery =
    memberQ && resolvedUserIds !== null
      ? { ...query, q: undefined, userIds: resolvedUserIds }
      : query;

  const { data, isLoading, isFetching } = useMembershipMembers(membershipQuery, {
    // disabled when memberQ is set but resolvedUserIds is not yet ready or empty
    enabled: !memberQ || (Array.isArray(resolvedUserIds) && resolvedUserIds.length > 0),
  });

  const columns = useMembershipMemberTableColumns({ onEdit: setSelectedMember });

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
