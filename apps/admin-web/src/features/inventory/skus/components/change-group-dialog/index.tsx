'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/common/form/form-field';
import { FormSelect } from '@/components/common/form/form-select';
import { useSkuGroups, useAddSkuToGroup, useRemoveSkuFromGroup } from '@/lib/services/inventory';
import type { SkuResponseDto } from '@/lib/types/dto/inventory';

type Props = {
  sku: SkuResponseDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ChangeGroupDialog({ sku, open, onOpenChange }: Props) {
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const { data: groups } = useSkuGroups();
  const addMutation = useAddSkuToGroup();
  const removeMutation = useRemoveSkuFromGroup();

  useEffect(() => {
    if (open && sku) {
      setSelectedGroupId(sku.groupId ?? '');
    }
  }, [open, sku]);

  if (!sku) return null;

  const groupOptions = [
    { value: '', label: '그룹 없음 (제거)' },
    ...(groups ?? []).map((g) => ({ value: g.id, label: g.name })),
  ];

  const handleSave = async () => {
    try {
      if (selectedGroupId) {
        await addMutation.mutateAsync({ groupId: selectedGroupId, skuId: sku.id });
      } else {
        await removeMutation.mutateAsync({ skuId: sku.id, groupId: sku.groupId ?? '' });
      }
      toast.success('그룹이 변경되었습니다.');
      onOpenChange(false);
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? e?.message ?? '그룹 변경에 실패했습니다.';
      toast.error(msg);
    }
  };

  const isPending = addMutation.isPending || removeMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>그룹 변경</DialogTitle>
        </DialogHeader>

        <div className="py-2 space-y-1">
          <p className="text-sm text-muted-foreground mb-3">
            <span className="font-medium text-foreground">{sku.code}</span> 의 그룹을 변경합니다.
          </p>
          <FormField label="SKU 그룹">
            <FormSelect
              value={selectedGroupId}
              onValueChange={setSelectedGroupId}
              options={groupOptions}
              placeholder="그룹 선택"
            />
          </FormField>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? '저장 중…' : '저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
