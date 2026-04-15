'use client';

import { useState } from 'react';
import { useMembershipMembers } from '@/lib/services/membership';
import { useDataTable } from '@/hooks/use-data-table';
import { useMembershipMemberTableColumns } from '@/hooks/table/columns/use-membership-member-table-columns';
import { useMembershipMemberTableQuery } from '@/hooks/table/query/use-membership-member-table-query';
import { DataTable } from '@/components/data-table';
import { AdminMemberListItem } from '@/lib/api/domains/membership';
import { MembershipMemberDetailDialog } from '../detail-dialog';

const PAGE_SIZE = 20;

export function MembershipMemberTable() {
  const [selectedMember, setSelectedMember] = useState<AdminMemberListItem | null>(null);

  const { searchParams: query } = useMembershipMemberTableQuery({
    pageSize: PAGE_SIZE,
  });
  const { data, isLoading, isFetching } = useMembershipMembers(query);
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
        isLoading={isLoading}
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
