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
import {
  methodsForStrategies,
  PICKING_METHOD_LABELS,
  type PickingMethod,
} from '../../picking-method';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateBatchDialog({ open, onOpenChange }: Props) {
  const { hasScope, isPermissionLoading } = usePermission();
  const { data: warehouses = [] } = useWarehouses();
  const mutation = useCreateOutboundBatchV2();
  const [warehouseId, setWarehouseId] = useState('');
  const [pickingMethod, setPickingMethod] = useState<PickingMethod | ''>('');
  const [cartCapacity, setCartCapacity] = useState('');
  const [name, setName] = useState('');
  const [scheduledPickingAt, setScheduledPickingAt] = useState('');
  const retry = useWarehouseCommandRetry();
  const canOperateWarehouse =
    !isPermissionLoading && !!hasScope([FULFILLMENT_SCOPES.operate]);

  const selectedWarehouse = warehouses.find((item) => item.id === warehouseId);
  const availableMethods = methodsForStrategies(
    selectedWarehouse?.supportedPickingStrategies ?? []
  );

  const handleWarehouseChange = (value: string) => {
    // Radix Select 는 값이 안 바뀌어도 onValueChange 를 발화한다. 이미 선택된
    // 창고를 다시 클릭했을 뿐인데 방식·바구니 수가 지워지는 것을 막는다.
    if (value === warehouseId) return;
    setWarehouseId(value);
    // 창고가 바뀌면 이전 창고 기준으로 고른 방식·바구니 수는 더 이상 유효하지 않을 수 있다
    // (예: multi_order 선택 후 pick_to_tote 미지원 창고로 변경). 항상 초기화해서
    // "화면엔 안 보이는데 상태엔 남아있는" 불일치를 막는다.
    setPickingMethod('');
    setCartCapacity('');
  };

  // 바구니 수 입력의 렌더 조건과 동일한 기준: 창고 리페치로 supportedPickingStrategies 가
  // 좁아져 pickingMethod 가 더 이상 availableMethods 에 없으면 stale 로 취급한다.
  const isPickingMethodValid =
    !!pickingMethod && availableMethods.includes(pickingMethod);
  const showCartCapacity =
    pickingMethod === 'multi_order' && availableMethods.includes('multi_order');
  // step={1} 은 브라우저 힌트일 뿐이라 붙여넣기로 2.5 같은 값이 들어올 수 있다.
  // 서버 @IsInt 가 이런 값을 400 으로 거부하므로 여기서도 정수만 통과시킨다.
  const isCartCapacityValid =
    !showCartCapacity ||
    (Number.isInteger(Number(cartCapacity)) && Number(cartCapacity) >= 1);

  const submit = async () => {
    const payload: CreateOutboundBatchV2Request = {
      warehouseId,
      // pickingMethod 은 여기서 항상 '' 가 아니다: disabled 조건(!isPickingMethodValid)이 제출을 막는다.
      pickingMethod: pickingMethod as PickingMethod,
      cartCapacity: showCartCapacity ? Number(cartCapacity) : undefined,
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
      setPickingMethod('');
      setCartCapacity('');
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
            <Select value={warehouseId} onValueChange={handleWarehouseChange}>
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
            <Label>피킹 방식</Label>
            <Select
              value={pickingMethod}
              // value 는 항상 availableMethods 로 만든 SelectItem 중 하나에서만 온다
              // (Select 는 목록에 없는 값을 onValueChange 로 넘기지 않는다).
              onValueChange={(value) => setPickingMethod(value as PickingMethod)}
              disabled={!warehouseId}
            >
              <SelectTrigger>
                <SelectValue placeholder="방식 선택" />
              </SelectTrigger>
              <SelectContent>
                {availableMethods.map((method) => (
                  <SelectItem key={method} value={method}>
                    {PICKING_METHOD_LABELS[method]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {warehouseId && availableMethods.length === 0 && (
              <p className="text-sm text-destructive">
                이 창고가 지원하는 피킹 전략이 없습니다. 배치를 만들 수 없습니다.
              </p>
            )}
          </div>
          {showCartCapacity && (
            <div className="space-y-1.5">
              <Label>카트 바구니 수</Label>
              <Input
                type="number"
                min={1}
                step={1}
                value={cartCapacity}
                onChange={(event) => setCartCapacity(event.target.value)}
                placeholder="24"
              />
              <p className="text-xs text-muted-foreground">
                바구니 하나가 송장 하나입니다. 이 배치에 담을 수 있는 송장 수 상한이
                됩니다.
              </p>
            </div>
          )}
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            onClick={submit}
            disabled={
              !warehouseId ||
              !isPickingMethodValid ||
              !isCartCapacityValid ||
              mutation.isPending
            }
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
