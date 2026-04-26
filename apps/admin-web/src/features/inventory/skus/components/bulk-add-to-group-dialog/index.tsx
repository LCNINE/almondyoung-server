'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/common/form/form-field';
import { FormSelect } from '@/components/common/form/form-select';
import { useSkuGroups, useBulkAddSkusToGroup } from '@/lib/services/inventory';

type Props = {
  skuIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function BulkAddToGroupDialog({ skuIds, open, onOpenChange }: Props) {
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const { data: groups } = useSkuGroups();
  const bulkMutation = useBulkAddSkusToGroup();

  const groupOptions = (groups ?? []).map((g) => ({ value: g.id, label: g.name }));

  const handleSave = async () => {
    if (!selectedGroupId) return;

    try {
      const result = await bulkMutation.mutateAsync({
        groupId: selectedGroupId,
        data: { skuIds },
      });

      if (result.failedCount > 0) {
        toast.warning(
          `${result.successCount}개 추가됨, ${result.failedCount}개 실패`
        );
      } else {
        toast.success(`${result.successCount}개 SKU가 그룹에 추가되었습니다.`);
      }
      onOpenChange(false);
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? e?.message ?? '그룹 추가에 실패했습니다.';
      toast.error(msg);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>그룹 일괄 추가</DialogTitle>
          <DialogDescription>
            선택한 {skuIds.length}개 SKU를 그룹에 추가합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <FormField label="대상 그룹" required>
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
          <Button
            onClick={handleSave}
            disabled={bulkMutation.isPending || !selectedGroupId}
          >
            {bulkMutation.isPending ? '추가 중…' : '추가'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
