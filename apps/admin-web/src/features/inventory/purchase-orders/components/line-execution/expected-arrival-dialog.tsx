'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getServerDenyMessage } from '@/lib/api/server-error';
import { useUpdatePurchaseOrderLineExpectedArrival } from '@/lib/services/inventory';
import type {
  PurchaseOrderDto,
  PurchaseOrderLineDto,
} from '@/lib/types/dto/inventory';
import { toast } from 'sonner';
import { toCalendarDate } from '../../line-execution-model';

type Props = {
  po: PurchaseOrderDto;
  line: PurchaseOrderLineDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ExpectedArrivalDialog({ po, line, open, onOpenChange }: Props) {
  const [expectedArrival, setExpectedArrival] = useState('');
  const mutation = useUpdatePurchaseOrderLineExpectedArrival();

  useEffect(() => {
    if (open) setExpectedArrival(toCalendarDate(line?.expectedArrival));
  }, [open, line]);

  if (!line) return null;

  const submit = async (value: string | null) => {
    try {
      await mutation.mutateAsync({
        poId: po.id,
        skuId: line.skuId,
        data: { expectedArrival: value },
      });
      toast.success(
        value ? '도착예정일을 수정했습니다.' : '도착예정일을 비웠습니다.'
      );
      onOpenChange(false);
    } catch (e: unknown) {
      toast.error(getServerDenyMessage(e, '도착예정일 수정에 실패했습니다.'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            예정일 수정 — {line.sku?.name ?? line.skuId}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1 py-2">
          <Label htmlFor="line-expected-arrival">도착예정일</Label>
          <Input
            id="line-expected-arrival"
            type="date"
            value={expectedArrival}
            onChange={(event) => setExpectedArrival(event.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            닫기
          </Button>
          <Button
            variant="outline"
            onClick={() => submit(null)}
            disabled={mutation.isPending}
          >
            비우기
          </Button>
          <Button
            onClick={() => submit(expectedArrival || null)}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? '저장 중…' : '저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
