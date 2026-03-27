'use client';

import { Suspense, useState, useEffect, useMemo, useCallback } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { useUserRoles, useReplaceUserRoles } from '@/lib/services/users';
import { useAdminRoles } from '@/lib/services/roles';
import { useDataTable } from '@/hooks/use-data-table';
import { DataTable } from '@/components/data-table';
import { toast } from 'sonner';
import { useUserRoleTableColumns } from '@/hooks/table/columns/use-user-role-table-columns';

const PAGE_SIZE = 10;

function UserRoleTable({ userId }: { userId: string }) {
  const { data: userRolesData } = useUserRoles(userId);
  const { data: allRoles } = useAdminRoles();
  const { mutate: replaceRoles, isPending } = useReplaceUserRoles(userId);

  const currentRoleIds = useMemo(
    () => userRolesData.roles.map((r) => r.roleId),
    [userRolesData.roles]
  );

  const [selectedRoleIds, setSelectedRoleIds] =
    useState<string[]>(currentRoleIds);

  useEffect(() => {
    setSelectedRoleIds(currentRoleIds);
  }, [currentRoleIds]);

  const handleToggle = useCallback((roleId: string, checked: boolean) => {
    setSelectedRoleIds((prev) =>
      checked ? [...prev, roleId] : prev.filter((id) => id !== roleId)
    );
  }, []);

  const rolesWithSelection = useMemo(
    () =>
      (allRoles ?? []).map((role) => ({
        ...role,
        isSelected: selectedRoleIds.includes(role.roleId),
      })),
    [allRoles, selectedRoleIds]
  );

  const columns = useUserRoleTableColumns({ onToggle: handleToggle });

  const { table } = useDataTable({
    data: rolesWithSelection,
    columns,
    count: rolesWithSelection.length,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.roleId,
  });

  const hasChanges =
    selectedRoleIds.length !== currentRoleIds.length ||
    selectedRoleIds.some((id) => !currentRoleIds.includes(id)) ||
    currentRoleIds.some((id) => !selectedRoleIds.includes(id));

  const handleSave = () => {
    replaceRoles(
      { roleIds: selectedRoleIds },
      {
        onSuccess: () => {
          toast.success('역할이 저장되었습니다.');
        },
        onError: (error) => {
          toast.error(error.message || '역할 저장에 실패했습니다.');
        },
      }
    );
  };

  return (
    <div>
      <DataTable
        table={table}
        count={rolesWithSelection.length}
        pageSize={PAGE_SIZE}
        noRecords={{ message: '역할이 없습니다.' }}
      />
      <div className="flex justify-end p-4 border-t">
        <Button onClick={handleSave} disabled={!hasChanges || isPending}>
          {isPending ? '저장 중...' : '저장'}
        </Button>
      </div>
    </div>
  );
}

export function UserDetailRole({ userId }: { userId: string }) {
  return (
    <Container className="divide-y">
      <Header title="권한" />
      <Suspense
        fallback={
          <div className="flex justify-center p-4">
            <Spinner />
          </div>
        }
      >
        <UserRoleTable userId={userId} />
      </Suspense>
    </Container>
  );
}
