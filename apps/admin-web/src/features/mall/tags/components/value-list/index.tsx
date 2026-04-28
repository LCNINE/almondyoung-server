'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useTagGroup, useDeleteTagValue } from '@/lib/services/products';
import type { TagValueDto } from '@/lib/types/dto/products';
import { toast } from 'sonner';
import { ValueCreateDialog } from '../value-create-dialog';
import { ValueEditDialog } from '../value-edit-dialog';
import { ValueDeleteDialog } from '../value-delete-dialog';

type Props = {
  groupId: string;
};

export function ValueList({ groupId }: Props) {
  const { data: group, isLoading } = useTagGroup(groupId);
  const deleteMutation = useDeleteTagValue();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<TagValueDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TagValueDto | null>(null);

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync({ id: deleteTarget.id, groupId });
      toast.success('태그 값이 삭제되었습니다.');
      setDeleteTarget(null);
    } catch {
      toast.error('삭제에 실패했습니다.');
    }
  };

  if (isLoading) {
    return (
      <div className="rounded-lg border p-4 text-sm text-muted-foreground">
        불러오는 중...
      </div>
    );
  }

  if (!group) {
    return (
      <div className="rounded-lg border p-4 text-sm text-muted-foreground">
        그룹을 찾을 수 없습니다.
      </div>
    );
  }

  const values = (group as typeof group & { values?: TagValueDto[] }).values ?? [];

  return (
    <div className="rounded-lg border">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <span className="text-sm font-medium">{group.name} — 태그 값</span>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          값 추가
        </Button>
      </div>

      {values.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">등록된 태그 값이 없습니다.</div>
      ) : (
        <ul className="divide-y">
          {values.map((value) => (
            <li
              key={value.id}
              className="flex items-center justify-between px-4 py-3"
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-sm">{value.name}</span>
                {value.displayOrder !== undefined && (
                  <span className="text-xs text-muted-foreground">순서 {value.displayOrder}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={value.isActive ? 'default' : 'secondary'} className="text-xs">
                  {value.isActive ? '활성' : '비활성'}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setEditTarget(value)}
                >
                  편집
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                  onClick={() => setDeleteTarget(value)}
                >
                  삭제
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ValueCreateDialog
        open={createOpen}
        groupId={groupId}
        onOpenChange={setCreateOpen}
      />

      <ValueEditDialog
        open={!!editTarget}
        value={editTarget}
        groupId={groupId}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
      />

      <ValueDeleteDialog
        open={!!deleteTarget}
        target={deleteTarget}
        isLoading={deleteMutation.isPending}
        onConfirm={handleDeleteConfirm}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      />
    </div>
  );
}
