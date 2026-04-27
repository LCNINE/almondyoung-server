'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useLocationColumns } from '@/lib/services/inventory';
import type { LocationColumnDto } from '@/lib/types/dto/inventory';
import { ColumnFormDialog } from '../column-form-dialog';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouseId: string;
};

export function ColumnsManagementDialog({ open, onOpenChange, warehouseId }: Props) {
  const { data: columns, isLoading } = useLocationColumns(warehouseId);
  const [editColumn, setEditColumn] = useState<LocationColumnDto | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>열 관리</DialogTitle>
          </DialogHeader>

          <div className="mb-4 flex justify-end">
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              새 열
            </Button>
          </div>

          {isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">로딩 중...</p>
          ) : (columns ?? []).length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">등록된 열이 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {(columns ?? []).map((col) => (
                <div
                  key={col.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-medium">{col.columnName}</span>
                    {col.displayOrder !== null && (
                      <span className="text-xs text-muted-foreground">순서 {col.displayOrder}</span>
                    )}
                    {!col.isActive && <Badge variant="destructive">비활성</Badge>}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditColumn(col)}
                  >
                    수정
                  </Button>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ColumnFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        warehouseId={warehouseId}
      />

      <ColumnFormDialog
        open={!!editColumn}
        onOpenChange={(o) => { if (!o) setEditColumn(null); }}
        warehouseId={warehouseId}
        editRow={editColumn}
      />
    </>
  );
}
