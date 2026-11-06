'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConsolidationSheet } from '@/features/order/fulfillments/detail/consolidation-sheet';
import { defaultWarehouseId } from '@/features/order/consolidation/board-model';
import { parseServerError } from '@/lib/api/server-error';
import { useCan, usePermissionCheck } from '@/hooks/use-permission';
import { permissionLabel } from '@/lib/auth/permission-labels';
import { useWarehouses } from '@/lib/services/inventory/queries';
import {
  createIdempotentCommand,
  getServerDenyMessage,
  useOutboundPreparationSummary,
  useSplitUnreservedMany,
} from '@/lib/services/orders';
import type {
  PreparationBucket,
  PreparationShipmentDto,
} from '@/lib/types/dto/fulfillment';
import {
  methodsForStrategies,
  PICKING_METHOD_LABELS,
  type PickingMethod,
} from '@/lib/utils/picking-method';
import { BATCH_ISSUE_LIMIT } from '../../waybill-issue/waybill-issue-model';
import { BucketTable } from '../components/bucket-table';
import { BucketList } from '../components/bucket-list';
import { PrepareDialog } from '../components/prepare-dialog';
import type { PreparationInput } from '../run-outbound-preparation';

export default function OutboundPreparationTemplate() {
  const { data: warehouses = [] } = useWarehouses();
  const [pickedWarehouse, setPickedWarehouse] = useState('');
  const warehouseId = pickedWarehouse || defaultWarehouseId(warehouses);

  return (
    <PreparationWarehouse
      key={warehouseId}
      warehouseId={warehouseId}
      warehouses={warehouses}
      onWarehouseChange={setPickedWarehouse}
    />
  );
}

function PreparationWarehouse({
  warehouseId,
  warehouses,
  onWarehouseChange,
}: {
  warehouseId: string;
  warehouses: NonNullable<ReturnType<typeof useWarehouses>['data']>;
  onWarehouseChange: (id: string) => void;
}) {
  const shipmentRead = useCan(['fulfillment.shipment.read']);
  const canRead = shipmentRead.status === 'ready' && shipmentRead.allowed;

  const summary = useOutboundPreparationSummary(warehouseId, canRead);
  const split = useSplitUnreservedMany();
  const { canRun } = usePermissionCheck();

  const [pickingMethod, setPickingMethod] =
    useState<PickingMethod>('total_picking');
  const [cartCapacity, setCartCapacity] = useState('');
  const [activeBucket, setActiveBucket] = useState<PreparationBucket | null>(
    null
  );
  const [selections, setSelections] = useState<
    Partial<Record<PreparationBucket, string[]>>
  >({});
  const [sheetShipmentId, setSheetShipmentId] = useState('');
  const [preparation, setPreparation] = useState<{
    input: PreparationInput;
    shipments: PreparationShipmentDto[];
    source: 'ready' | 'resume' | 'mergeable';
  } | null>(null);
  const [splitting, setSplitting] = useState(false);
  const splitRunning = useRef(false);
  const splitCommand = useRef<ReturnType<
    typeof createIdempotentCommand<{ shipmentIds: string[] }>
  > | null>(null);

  const methods = methodsForStrategies(
    warehouses.find((warehouse) => warehouse.id === warehouseId)
      ?.supportedPickingStrategies ?? []
  );
  const validCapacity =
    pickingMethod !== 'multi_order' ||
    (Number.isInteger(Number(cartCapacity)) && Number(cartCapacity) >= 1);
  const canPrepare = methods.includes(pickingMethod) && validCapacity;
  const busy = splitting || preparation !== null;
  const bucket = summary.data?.buckets.find(
    (entry) => entry.bucket === activeBucket
  );

  const selectedIds = (key: PreparationBucket) => {
    const shipments =
      summary.data?.buckets.find((entry) => entry.bucket === key)?.shipments ??
      [];
    const selected = selections[key];

    return selected === undefined
      ? shipments
          .slice(0, BATCH_ISSUE_LIMIT)
          .map((shipment) => shipment.shipmentId)
      : shipments
          .filter((shipment) => selected.includes(shipment.shipmentId))
          .map((shipment) => shipment.shipmentId);
  };

  const toggle = (id: string, checked: boolean) => {
    if (!activeBucket) {
      return;
    }

    const ids = selectedIds(activeBucket);

    if (checked && ids.length >= BATCH_ISSUE_LIMIT) {
      toast.error('한 번에 100건까지 처리해요');

      return;
    }

    setSelections((previous) => ({
      ...previous,
      [activeBucket]: checked
        ? [...ids, id]
        : ids.filter((selected) => selected !== id),
    }));
  };

  const prepare = (key: 'ready' | 'resume' | 'mergeable') => {
    const ids = selectedIds(key);

    if (!canPrepare || busy || ids.length === 0) {
      return;
    }

    setPreparation({
      input: {
        warehouseId,
        shipmentIds: ids,
        pickingMethod,
        cartCapacity:
          pickingMethod === 'multi_order' ? Number(cartCapacity) : undefined,
        now: new Date(),
      },
      shipments:
        summary.data?.buckets
          .find((entry) => entry.bucket === key)
          ?.shipments.filter((shipment) => ids.includes(shipment.shipmentId)) ??
        [],
      source: key,
    });
  };

  const splitSelected = async () => {
    const shipmentIds = selectedIds('partial');

    if (
      !canRun(useSplitUnreservedMany) ||
      splitRunning.current ||
      shipmentIds.length === 0
    ) {
      return;
    }

    splitRunning.current = true;
    setSplitting(true);

    if (
      !splitCommand.current ||
      splitCommand.current.data.shipmentIds.join(',') !== shipmentIds.join(',')
    ) {
      splitCommand.current = createIdempotentCommand({ shipmentIds });
    }

    try {
      const result = await split.mutateAsync(splitCommand.current);

      splitCommand.current = null;
      toast.success(`${result.succeeded.length}건을 나눴어요`);

      if (result.failed.length > 0) {
        toast.error(`${result.failed.length}건은 나누지 못했어요`);
      }

      setSelections((previous) => ({
        ...previous,
        partial: result.failed.map((failure) => failure.shipmentId),
      }));
    } catch (error) {
      const { status } = parseServerError(error);

      if (status !== null && status < 500) {
        splitCommand.current = null;
      }

      toast.error(getServerDenyMessage(error, '상자를 나누지 못했어요.'));
    } finally {
      splitRunning.current = false;
      setSplitting(false);
    }
  };

  return (
    <div className="space-y-6 p-4">
      <div>
        <h1 className="text-lg font-semibold">출고 준비</h1>
        <p className="text-sm text-muted-foreground">
          창고를 고르면 오늘 보낼 상자를 한 번에 준비해요.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="preparation-warehouse">창고</Label>
          <Select
            value={warehouseId}
            onValueChange={onWarehouseChange}
            disabled={busy}
          >
            <SelectTrigger
              id="preparation-warehouse"
              className="w-[220px]"
              aria-label="창고"
            >
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
          <Label htmlFor="preparation-picking">피킹 방식</Label>
          <Select
            value={pickingMethod}
            onValueChange={(value) => {
              const method = methods.find((method) => method === value);

              if (method) {
                setPickingMethod(method);
              }
            }}
            disabled={busy || !warehouseId}
          >
            <SelectTrigger
              id="preparation-picking"
              className="w-[240px]"
              aria-label="피킹 방식"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {methods.map((method) => (
                <SelectItem key={method} value={method}>
                  {PICKING_METHOD_LABELS[method]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {pickingMethod === 'multi_order' && (
          <div className="space-y-1.5">
            <Label htmlFor="preparation-capacity">카트 용량</Label>
            <Input
              id="preparation-capacity"
              className="w-[160px]"
              type="number"
              min={1}
              step={1}
              value={cartCapacity}
              disabled={busy}
              onChange={(event) => setCartCapacity(event.target.value)}
            />
          </div>
        )}
      </div>
      {warehouseId && !methods.includes(pickingMethod) && (
        <p className="text-sm font-semibold text-foreground">
          이 창고에서 지원하는 피킹 방식을 골라 주세요.
        </p>
      )}
      {!warehouseId && (
        <p className="text-sm text-muted-foreground">창고를 골라 주세요.</p>
      )}
      {canRead && warehouseId && summary.isLoading && (
        <p role="status" className="text-sm text-muted-foreground">
          출고 준비 내역을 불러오고 있어요.
        </p>
      )}
      {!canRead ? (
        shipmentRead.status === 'ready' && (
          <p className="text-sm text-muted-foreground">
            상자 목록은 {permissionLabel('fulfillment.shipment.read')} 권한이
            있어야 보여요.
          </p>
        )
      ) : summary.isError ? (
        <div role="alert" className="space-y-2">
          <p className="text-sm">출고 준비 내역을 불러오지 못했어요.</p>
          <Button variant="outline" onClick={() => void summary.refetch()}>
            다시 불러오기
          </Button>
        </div>
      ) : (
        summary.data && (
          <>
            <BucketTable
              summary={summary.data}
              busy={busy}
              canPrepare={canPrepare}
              selectedCount={(key) => selectedIds(key).length}
              onView={setActiveBucket}
              onPrepare={prepare}
              onSplit={() => void splitSelected()}
            />
            {bucket && (
              <BucketList
                bucket={bucket}
                selectedIds={selectedIds(bucket.bucket)}
                busy={busy}
                onToggle={toggle}
                onMerge={setSheetShipmentId}
                canPrepare={canPrepare}
                onPrepareSeparately={() => prepare('mergeable')}
              />
            )}
          </>
        )
      )}
      {preparation && (
        <PrepareDialog {...preparation} onClose={() => setPreparation(null)} />
      )}
      {sheetShipmentId && (
        <ConsolidationSheet
          shipmentId={sheetShipmentId}
          open
          onOpenChange={(open) => {
            if (!open) {
              setSheetShipmentId('');
            }
          }}
          onRequested={() => {
            void summary.refetch();
          }}
        />
      )}
    </div>
  );
}
