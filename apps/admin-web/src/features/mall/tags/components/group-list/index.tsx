'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils/cn';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useTagGroups, useDeleteTagGroup } from '@/lib/services/products';
import type { TagGroupDto } from '@/lib/types/dto/products';
import { toast } from 'sonner';
import { GroupCreateDialog } from '../group-create-dialog';
import { GroupEditDialog } from '../group-edit-dialog';
import { GroupDeleteDialog } from '../group-delete-dialog';

type Props = {
  selectedGroupId?: string;
  onSelectGroup: (groupId: string) => void;
};

export function GroupList({ selectedGroupId, onSelectGroup }: Props) {
  const { data: groups, isLoading } = useTagGroups();
  const deleteMutation = useDeleteTagGroup();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<TagGroupDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TagGroupDto | null>(null);

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      toast.success('태그 그룹이 삭제되었습니다.');
      setDeleteTarget(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '';
      toast.error(msg.includes('restrict') || msg.includes('값') ? '태그 값이 남아있어 삭제할 수 없습니다.' : '삭제에 실패했습니다.');
    }
  };

  return (
    <div className="rounded-lg border">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <span className="text-sm font-medium">태그 그룹</span>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          그룹 추가
        </Button>
      </div>

      {isLoading ? (
        <div className="p-4 text-sm text-muted-foreground">불러오는 중...</div>
      ) : !groups || groups.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">태그 그룹이 없습니다.</div>
      ) : (
        <ul className="divide-y">
          {groups.map((group) => (
            <li
              key={group.id}
              className={cn(
                'flex cursor-pointer items-center justify-between px-4 py-3 transition-colors hover:bg-muted/50',
                selectedGroupId === group.id && 'bg-muted'
              )}
              onClick={() => onSelectGroup(group.id)}
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{group.name}</span>
                {group.valueCount !== undefined && (
                  <span className="text-xs text-muted-foreground">
                    값 {group.valueCount}개
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <Badge variant={group.isActive ? 'default' : 'secondary'} className="text-xs">
                  {group.isActive ? '활성' : '비활성'}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setEditTarget(group)}
                >
                  편집
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                  onClick={() => setDeleteTarget(group)}
                >
                  삭제
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <GroupCreateDialog open={createOpen} onOpenChange={setCreateOpen} />

      <GroupEditDialog
        open={!!editTarget}
        group={editTarget}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
      />

      <GroupDeleteDialog
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
