'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePermission } from '@/hooks/use-permission';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useWarehouses } from '@/lib/services/inventory/queries';
import {
  FULFILLMENT_SCOPES,
  getServerDenyMessage,
  useCreateOutboundBatchV2,
} from '@/lib/services/orders';
import type { CreateOutboundBatchV2Request } from '@/lib/types/dto/fulfillment';
import { useWarehouseCommandRetry } from '../../warehouse-command-retry';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateBatchDialog({ open, onOpenChange }: Props) {
  const { hasScope, isPermissionLoading } = usePermission();
  const { data: warehouses = [] } = useWarehouses();
  const mutation = useCreateOutboundBatchV2();
  const [warehouseId, setWarehouseId] = useState('');
  const [name, setName] = useState('');
  const [scheduledPickingAt, setScheduledPickingAt] = useState('');
  const retry = useWarehouseCommandRetry();
  const canOperateWarehouse =
    !isPermissionLoading && !!hasScope([FULFILLMENT_SCOPES.operate]);

  const submit = async () => {
    const payload: CreateOutboundBatchV2Request = {
      warehouseId,
      pickingMethod: 'individual',
      name: name.trim() || undefined,
      scheduledPickingAt: scheduledPickingAt
        ? new Date(scheduledPickingAt).toISOString()
        : undefined,
    };
    try {
      await retry.execute('create', payload, (data, idempotencyKey) =>
        mutation.mutateAsync({ data, idempotencyKey })
      );
      toast.success('V2 출고 배치가 생성되었습니다.');
      setName('');
      setScheduledPickingAt('');
      onOpenChange(false);
    } catch (error) {
      toast.error(getServerDenyMessage(error));
    }
  };

  if (!canOperateWarehouse) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>V2 출고 배치 생성</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>창고</Label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger>
                <SelectValue placeholder="창고 선택" />
              </SelectTrigger>
              <SelectContent>
                {warehouses.map((warehouse) => (
                  <SelectItem key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>배치명</Label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="오전 1차 출고"
            />
          </div>
          <div className="space-y-1.5">
            <Label>피킹 예정 시각</Label>
            <Input
              type="datetime-local"
              value={scheduledPickingAt}
              onChange={(event) => setScheduledPickingAt(event.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            피킹 전략은 배치 생성 뒤 창고가 지원하는 전략 중에서 계획합니다.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            onClick={submit}
            disabled={!warehouseId || mutation.isPending}
          >
            {mutation.isPending
              ? '서버 확인 중…'
              : retry.hasPending('create')
                ? '원래 명령 재시도'
                : '생성'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
