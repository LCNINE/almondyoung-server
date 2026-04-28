'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useWarehouses } from '@/lib/services/inventory/queries';
import { useCreateOutboundBatch } from '@/lib/services/orders';
import type { CreateOutboundBatchRequest, PickingMethod } from '@/lib/types/dto/fulfillment';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateBatchDialog({ open, onOpenChange }: Props) {
  const { data: warehouses = [] } = useWarehouses();
  const createBatch = useCreateOutboundBatch();

  const { register, handleSubmit, setValue, watch, reset } = useForm<CreateOutboundBatchRequest>({
    defaultValues: {
      pickingMethod: 'individual',
    },
  });

  const warehouseId = watch('warehouseId');
  const pickingMethod = watch('pickingMethod');

  const onSubmit = async (data: CreateOutboundBatchRequest) => {
    await createBatch.mutateAsync(data);
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>출고 배치 생성</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>창고</Label>
            <Select
              value={warehouseId}
              onValueChange={(v) => setValue('warehouseId', v)}
              required
            >
              <SelectTrigger>
                <SelectValue placeholder="창고 선택" />
              </SelectTrigger>
              <SelectContent>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>피킹 방식</Label>
            <Select
              value={pickingMethod}
              onValueChange={(v) => setValue('pickingMethod', v as PickingMethod)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="individual">개별 피킹</SelectItem>
                <SelectItem value="total_picking">합산 피킹</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>배치명 (선택)</Label>
            <Input {...register('name')} placeholder="예: 2024-01-15 오전 배치" />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              취소
            </Button>
            <Button type="submit" disabled={createBatch.isPending || !warehouseId}>
              생성
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
