'use client';

import { useState } from 'react';
import { Can } from '@/components/auth/can';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { DataTable } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { useDataTable } from '@/hooks/use-data-table';
import { useUserTableFilters } from '@/hooks/table/filters/use-user-table-filters';
import { useUserTableQuery } from '@/hooks/table/query/use-user-table-query';
import { CreateAdminDialog } from '@/features/users/components/create-admin-dialog';
import { useAddRoleMembers } from '@/lib/services/roles';
import {
  useAdminUsers,
  useCreateAdminAccount,
  useMe,
} from '@/lib/services/users';
import { AddRoleDialog } from './add-role-dialog';
import { useStaffTableColumns } from './use-staff-table-columns';

const PAGE_SIZE = 20;

/** 직원 역할(고객 역할 밖)을 지금 가진 사람 — 기간이 있는 부여 포함. */
export function StaffList() {
  const { searchParams: query } = useUserTableQuery({ pageSize: PAGE_SIZE });
  const { data, isLoading, isFetching } = useAdminUsers({
    ...query,
    audience: 'staff',
  });
  const columns = useStaffTableColumns();
  const filters = useUserTableFilters();
  const [createOpen, setCreateOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const { table } = useDataTable({
    data: data?.data ?? [],
    columns,
    count: data?.total,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.id,
    enableRowSelection: true,
  });
  const { data: me } = useMe();
  const picked = table.getSelectedRowModel().rows.map((row) => row.original.id);
  // 자기 역할은 다른 관리자가 바꾼다 — 섞여 있으면 서버가 요청 전체를 거절하므로 미리 뺀다.
  const selfPicked = me !== undefined && picked.includes(me.id);
  const selected = picked.filter((id) => id !== me?.id);

  return (
    <Container>
      <Header title="관리자" />
      <Can run={useCreateAdminAccount}>
        <div className="flex justify-end p-2">
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            관리자 추가
          </Button>
        </div>
      </Can>
      {picked.length > 0 && (
        <div className="flex items-center gap-2 border-b bg-muted/50 p-3">
          <span className="text-sm text-muted-foreground">
            {selected.length}명 선택됨
            {selfPicked &&
              ' (나 자신은 빼고 — 자기 역할은 다른 관리자가 바꿔야 합니다)'}
          </span>
          {selected.length > 0 && (
            <Can run={useAddRoleMembers}>
              <Button size="sm" onClick={() => setAddOpen(true)}>
                역할 추가
              </Button>
            </Can>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => table.resetRowSelection()}
          >
            선택 해제
          </Button>
        </div>
      )}
      <DataTable
        table={table}
        isLoading={isLoading}
        isFetching={isFetching}
        count={data?.total ?? 0}
        pageSize={PAGE_SIZE}
        filters={filters}
        orderBy={[
          { key: 'loginId', label: '로그인 ID' },
          { key: 'email', label: '이메일' },
          { key: 'createdAt', label: '가입일' },
        ]}
        search
        navigateTo={(row) => `/users/${row.original.id}`}
        noRecords={{ message: '직원 역할을 가진 계정이 없습니다.' }}
      />
      <AddRoleDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        userIds={selected}
        onDone={() => table.resetRowSelection()}
      />
      <CreateAdminDialog open={createOpen} onOpenChange={setCreateOpen} />
    </Container>
  );
}
