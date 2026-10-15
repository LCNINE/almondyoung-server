'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { CalendarDays, Save } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RestockPolicySection } from './restock-policy-section';
import {
  normalizeStockPolicy,
  useUpdateVariantStockPolicy,
} from '@/lib/services/matching';
import { toLocalDateString } from '@/lib/utils/date';
import type { ProductVariantTableRow } from '@/hooks/table/columns/use-product-variants-table-columns';

export function ProductVariantRestockDialog({
  variant,
  open,
  onOpenChange,
}: {
  variant: ProductVariantTableRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const original = normalizeStockPolicy(variant.matchingInfo?.stockPolicy);
  const [policy, setPolicy] = useState(original);

  const update = useUpdateVariantStockPolicy();
  const hasChanges =
    policy.restockDate !== original.restockDate ||
    policy.restockApproximate !== original.restockApproximate;
  const isPastDate =
    !!policy.restockDate && policy.restockDate < toLocalDateString(new Date());

  const save = async () => {
    if (!hasChanges || isPastDate || update.isPending) return;

    try {
      // 재입고 정보만 저장한다. 다른 운영자가 변경한 매칭/재고 정책을 오래된 화면값으로 덮지 않는다.
      await update.mutateAsync({
        variantId: variant.id,
        data: {
          restockDate: policy.restockDate ?? null,
          restockApproximate: policy.restockApproximate ?? false,
        },
      });
      toast.success(
        '재입고 예정일을 저장했습니다. 고객 화면에 자동 반영됩니다.'
      );
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : '재입고 예정일 저장에 실패했습니다.'
      );
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!update.isPending) onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
            재입고 예정일 변경
          </DialogTitle>
          <DialogDescription>
            {variant.variantName ?? '기본 품목'}
          </DialogDescription>
        </DialogHeader>

        <fieldset disabled={update.isPending}>
          <RestockPolicySection value={policy} onChange={setPolicy} />
        </fieldset>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={update.isPending}
            onClick={() => onOpenChange(false)}
          >
            취소
          </Button>
          <Button
            type="button"
            disabled={!hasChanges || isPastDate || update.isPending}
            onClick={save}
          >
            <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {update.isPending ? '저장 중...' : '저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
