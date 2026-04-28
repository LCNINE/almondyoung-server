'use client';

import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useUpdateLocation } from '@/lib/services/inventory';
import type { LocationDto, UpdateLocationRequest } from '@/lib/types/dto/inventory';
import { toast } from 'sonner';

type Props = {
  row: LocationDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function LocationDetailDrawer({ row, open, onOpenChange }: Props) {
  const [form, setForm] = useState<UpdateLocationRequest>({});
  const [editing, setEditing] = useState(false);
  const updateMutation = useUpdateLocation();

  useEffect(() => {
    if (row) {
      setForm({
        displayName: row.displayName,
        capacityLimit: row.capacityLimit ?? undefined,
        fifoRank: row.fifoRank ?? undefined,
        isExpirySeparated: row.isExpirySeparated,
        isActive: row.isActive,
        notes: row.notes ?? undefined,
      });
      setEditing(false);
    }
  }, [row]);

  if (!row) return null;

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync({ id: row.id, data: form });
      toast.success('로케이션 정보가 수정되었습니다.');
      setEditing(false);
    } catch {
      toast.error('수정에 실패했습니다.');
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[480px] overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle className="font-mono">{row.code}</SheetTitle>
        </SheetHeader>

        <div className="mb-6 flex gap-2">
          <Badge variant={row.locationType === 'standard' ? 'outline' : 'secondary'}>
            {row.locationType === 'standard' ? '표준' : '구역'}
          </Badge>
          <Badge variant={row.isActive ? 'default' : 'destructive'}>
            {row.isActive ? '활성' : '비활성'}
          </Badge>
          {row.isSystem && <Badge variant="secondary">시스템</Badge>}
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="detail-display-name">표시명</Label>
            <Input
              id="detail-display-name"
              value={form.displayName ?? ''}
              disabled={!editing}
              onChange={(e) => setForm((p) => ({ ...p, displayName: e.target.value || undefined }))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="detail-capacity">용량 제한</Label>
            <Input
              id="detail-capacity"
              type="number"
              min="0"
              value={form.capacityLimit ?? ''}
              disabled={!editing}
              onChange={(e) =>
                setForm((p) => ({ ...p, capacityLimit: e.target.value ? Number(e.target.value) : undefined }))
              }
              placeholder="제한 없음"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="detail-fifo">FIFO 순위</Label>
            <Input
              id="detail-fifo"
              type="number"
              min="0"
              value={form.fifoRank ?? ''}
              disabled={!editing}
              onChange={(e) =>
                setForm((p) => ({ ...p, fifoRank: e.target.value ? Number(e.target.value) : undefined }))
              }
              placeholder="미설정"
            />
          </div>

          <div className="flex items-center gap-3">
            <input
              id="detail-expiry"
              type="checkbox"
              checked={form.isExpirySeparated ?? false}
              disabled={!editing}
              onChange={(e) => setForm((p) => ({ ...p, isExpirySeparated: e.target.checked }))}
              className="size-4 rounded border"
            />
            <Label htmlFor="detail-expiry">유통기한 분리 보관</Label>
          </div>

          <div className="flex items-center gap-3">
            <input
              id="detail-active"
              type="checkbox"
              checked={form.isActive ?? true}
              disabled={!editing}
              onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))}
              className="size-4 rounded border"
            />
            <Label htmlFor="detail-active">활성</Label>
          </div>

          <div className="space-y-2">
            <Label htmlFor="detail-notes">메모</Label>
            <Input
              id="detail-notes"
              value={form.notes ?? ''}
              disabled={!editing}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value || undefined }))}
              placeholder="내부 메모"
            />
          </div>
        </div>

        <div className="mt-8 flex gap-2">
          {editing ? (
            <>
              <Button variant="outline" className="flex-1" onClick={() => setEditing(false)}>
                취소
              </Button>
              <Button
                className="flex-1"
                onClick={handleSave}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? '저장 중...' : '저장'}
              </Button>
            </>
          ) : (
            <Button variant="outline" className="flex-1" onClick={() => setEditing(true)}>
              수정
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
