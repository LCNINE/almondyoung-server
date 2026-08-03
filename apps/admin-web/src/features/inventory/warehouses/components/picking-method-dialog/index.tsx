'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { getServerDenyMessage } from '@/lib/api/server-error';
import { useUpdateWarehouse } from '@/lib/services/inventory';
import type { WarehouseDto } from '@/lib/types/dto/inventory';
import {
  methodsForStrategies,
  PICKING_METHOD_LABELS,
  STRATEGY_BY_PICKING_METHOD,
  type PickingMethod,
} from '@/lib/utils/picking-method';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouse: WarehouseDto | null;
};

const ALL_METHODS = Object.keys(STRATEGY_BY_PICKING_METHOD) as PickingMethod[];

export function PickingMethodDialog({ open, onOpenChange, warehouse }: Props) {
  const [selected, setSelected] = useState<PickingMethod[]>([]);
  const mutation = useUpdateWarehouse();

  useEffect(() => {
    setSelected(methodsForStrategies(warehouse?.supportedPickingStrategies ?? []));
  }, [warehouse, open]);

  const toggle = (method: PickingMethod, checked: boolean) => {
    setSelected((prev) =>
      checked ? [...prev, method] : prev.filter((item) => item !== method)
    );
  };

  const handleSubmit = async () => {
    if (!warehouse) return;
    // 화면은 방식으로 다루고 API 는 전략을 받는다. ALL_METHODS 순서로 매핑해
    // 체크 순서가 저장 값의 순서를 흔들지 않게 한다.
    const strategies = ALL_METHODS.filter((method) => selected.includes(method)).map(
      (method) => STRATEGY_BY_PICKING_METHOD[method]
    );
    try {
      await mutation.mutateAsync({
        id: warehouse.id,
        data: { supportedPickingStrategies: strategies },
      });
      toast.success('피킹 방식이 저장되었습니다.');
      onOpenChange(false);
    } catch (error) {
      toast.error(getServerDenyMessage(error));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{warehouse?.name} — 지원하는 피킹 방식</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {ALL_METHODS.map((method) => (
            <div key={method} className="flex items-center gap-3">
              <Checkbox
                id={`method-${method}`}
                checked={selected.includes(method)}
                onCheckedChange={(checked) => toggle(method, checked === true)}
              />
              <Label htmlFor={`method-${method}`}>{PICKING_METHOD_LABELS[method]}</Label>
            </div>
          ))}

          {selected.length === 0 && (
            // 빈 배열은 유효한 저장이다. 그 결과가 무엇인지 저장 전에 알려준다.
            <p className="text-destructive text-sm">
              ⚠ 하나도 고르지 않으면 이 창고로 출고 배치를 만들 수 없습니다.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending ? '저장 중...' : '저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
