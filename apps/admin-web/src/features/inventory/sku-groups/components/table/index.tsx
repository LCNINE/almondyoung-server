'use client';

import { useCallback, useState } from 'react';
import { DataTable } from '@/components/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { useSkuGroupsTableColumns } from '@/hooks/table/columns/use-sku-groups-table-columns';
import { useSkuGroups } from '@/lib/services/inventory';
import type { SkuGroupResponseDto } from '@/lib/types/dto/inventory';
import { GroupFormDialog } from '../group-form-dialog';
import { DeleteGroupDialog } from '../delete-group-dialog';
import { MembersDrawer } from '../members-drawer';
import { Button } from '@/components/ui/button';

const PAGE_SIZE = 50;

export function SkuGroupsTable() {
  const { data: groups, isLoading, isFetching } = useSkuGroups();

  const [editRow, setEditRow] = useState<SkuGroupResponseDto | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteRow, setDeleteRow] = useState<SkuGroupResponseDto | null>(null);
  const [membersRow, setMembersRow] = useState<SkuGroupResponseDto | null>(null);

  const handleEdit = useCallback((row: SkuGroupResponseDto) => setEditRow(row), []);
  const handleViewMembers = useCallback((row: SkuGroupResponseDto) => setMembersRow(row), []);
  const handleDelete = useCallback((row: SkuGroupResponseDto) => setDeleteRow(row), []);

  const columns = useSkuGroupsTableColumns({
    onEdit: handleEdit,
    onViewMembers: handleViewMembers,
    onDelete: handleDelete,
  });

  const rows = groups ?? [];

  const { table } = useDataTable({
    data: rows,
    columns,
    count: rows.length,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.id,
  });

  return (
    <div>
      <div className="flex items-center justify-between p-3 border-b">
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          그룹 생성
        </Button>
      </div>

      <DataTable
        table={table}
        isLoading={isLoading}
        isFetching={isFetching}
        count={rows.length}
        pageSize={PAGE_SIZE}
        search
        noRecords={{ message: 'SKU 그룹이 없습니다.' }}
      />

      <GroupFormDialog
        open={createOpen || !!editRow}
        group={editRow}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setEditRow(null);
          }
        }}
      />

      <DeleteGroupDialog
        group={deleteRow}
        open={!!deleteRow}
        onOpenChange={(open) => { if (!open) setDeleteRow(null); }}
      />

      <MembersDrawer
        group={membersRow}
        open={!!membersRow}
        onOpenChange={(open) => { if (!open) setMembersRow(null); }}
      />
    </div>
  );
}
