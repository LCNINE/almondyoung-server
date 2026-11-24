'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
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
import {
  bulkSelectableShipments,
  SELECTABLE_BUCKETS,
  locatePreparationTarget,
  PREPARATION_BATCH_LIMIT,
  preparationAddress,
  preparationTargetNotice,
} from '../preparation-model';
import { BUCKET_LABELS, BucketTable } from '../components/bucket-table';
import { BucketList } from '../components/bucket-list';
import { PrepareDialog } from '../components/prepare-dialog';
import { SplitConfirmDialog } from '../components/split-confirm-dialog';
import { SplitResultDialog } from '../components/split-result-dialog';
import {
  retryTransientBulk,
  type PreparationInput,
} from '@/lib/services/orders/outbound-preparation-runner';

export default function OutboundPreparationTemplate() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: warehouses = [], isSuccess: warehousesLoaded } =
    useWarehouses();
  // 합포장 결과의 «이 상자 출고 준비»는 ?warehouseId=&prepare=<상자> 로 들어온다
  const [pickedWarehouse, setPickedWarehouse] = useState(
    () => searchParams.get('warehouseId') ?? ''
  );
  const [target, setTarget] = useState(() => searchParams.get('prepare') ?? '');
  const warehouseId = pickedWarehouse || defaultWarehouseId(warehouses);

  // 처리한 뒤에는 새로고침해도 같은 상자로 다시 열리지 않게 상자만 주소에서 지운다
  const clearTarget = useCallback(
    (nextWarehouseId?: string) => {
      setTarget('');

      const next = preparationAddress(
        pathname,
        searchParams.toString(),
        nextWarehouseId
      );

      if (next) {
        router.replace(next);
      }
    },
    [pathname, router, searchParams]
  );

  return (
    <PreparationWarehouse
      key={warehouseId}
      warehouseId={warehouseId}
      warehouses={warehouses}
      warehousesLoaded={warehousesLoaded}
      initialTarget={target}
      onTargetHandled={clearTarget}
      onWarehouseChange={(id) => {
        clearTarget(id);
        setPickedWarehouse(id);
      }}
    />
  );
}

function PreparationWarehouse({
  warehouseId,
  warehouses,
  warehousesLoaded,
  initialTarget,
  onTargetHandled,
  onWarehouseChange,
}: {
  warehouseId: string;
  warehouses: NonNullable<ReturnType<typeof useWarehouses>['data']>;
  warehousesLoaded: boolean;
  initialTarget: string;
  onTargetHandled: () => void;
  onWarehouseChange: (id: string) => void;
}) {
  const shipmentRead = useCan(['fulfillment.shipment.read']);
  const canRead = shipmentRead.status === 'ready' && shipmentRead.allowed;

  // 화주(= 송장 보내는 분)로 거른다. 여럿 고르면 같은 업체의 여러 판매처 상자를 한 번에 본다
  const [holderFilter, setHolderFilter] = useState<string[]>([]);
  const summary = useOutboundPreparationSummary(
    warehouseId,
    canRead,
    'always',
    holderFilter
  );
  const split = useSplitUnreservedMany();
  const { canRun } = usePermissionCheck();

  const [pickedMethod, setPickingMethod] =
    useState<PickingMethod>('total_picking');
  const [cartCapacity, setCartCapacity] = useState('');
  const [activeBucket, setActiveBucket] = useState<PreparationBucket | null>(
    null
  );
  const [selections, setSelections] = useState<
    Partial<Record<PreparationBucket, string[]>>
  >({});
  const [sheetShipmentId, setSheetShipmentId] = useState('');
  const [target, setTarget] = useState(initialTarget);
  const [targetNotice, setTargetNotice] = useState<string | null>(null);
  const holderOptions = summary.data?.holders ?? [];

  // 가려진 상자가 선택된 채 출고 준비로 넘어가지 않게 고른 것을 비운다
  const pickHolders = (next: string[]) => {
    setHolderFilter(next);
    setSelections({});
  };

  useEffect(() => {
    if (initialTarget && !target) {
      onTargetHandled();
    }
  }, [initialTarget, target, onTargetHandled]);
  const [preparation, setPreparation] = useState<{
    input: PreparationInput;
    shipments: PreparationShipmentDto[];
    source: 'ready' | 'resume' | 'mergeable';
  } | null>(null);
  const [splitting, setSplitting] = useState(false);
  // 창을 연 때 고른 상자. 열어 둔 사이 새로 들어온 상자는 섞이지 않는다
  const [confirmingSplit, setConfirmingSplit] = useState<string[] | null>(null);
  const [splitDone, setSplitDone] = useState<{
    shipments: PreparationShipmentDto[];
    failedCount: number;
  } | null>(null);
  const splitRunning = useRef(false);
  const splitCommand = useRef<ReturnType<
    typeof createIdempotentCommand<{ shipmentIds: string[] }>
  > | null>(null);

  const methods = methodsForStrategies(
    warehouses.find((warehouse) => warehouse.id === warehouseId)
      ?.supportedPickingStrategies ?? []
  );
  const pickingMethod =
    !methods.includes(pickedMethod) && methods.length === 1
      ? methods[0]
      : pickedMethod;
  const validCapacity =
    pickingMethod !== 'multi_order' ||
    (Number.isInteger(Number(cartCapacity)) && Number(cartCapacity) >= 1);
  const canPrepare = methods.includes(pickingMethod) && validCapacity;
  const busy = splitting || preparation !== null;
  const bucket = summary.data?.buckets.find(
    (entry) => entry.bucket === activeBucket
  );

  // 넘어온 상자는 최신 요약에서 한 번만 찾는다. 바로 준비할 수 있으면 그 상자만 담은 확인 창을 연다.
  // 피킹 방식은 창고 목록에서 정해지므로 목록이 온 뒤에 판정한다.
  if (
    target &&
    warehousesLoaded &&
    summary.data &&
    !summary.isFetching &&
    !busy
  ) {
    const found = locatePreparationTarget(summary.data, target);

    setTarget('');
    setTargetNotice(
      preparationTargetNotice(
        found,
        found.kind === 'missing' ? '' : BUCKET_LABELS[found.bucket],
        canPrepare
      )
    );

    if (found.kind !== 'missing') {
      setActiveBucket(found.bucket);
      setSelections((previous) => ({
        ...previous,
        [found.bucket]: [found.shipment.shipmentId],
      }));
    }

    if (found.kind === 'prepare' && canPrepare) {
      setPreparation({
        input: {
          warehouseId,
          shipmentIds: [found.shipment.shipmentId],
          pickingMethod,
          cartCapacity:
            pickingMethod === 'multi_order' ? Number(cartCapacity) : undefined,
          now: new Date(),
        },
        shipments: [found.shipment],
        source: found.bucket,
      });
    }
  }

  const selectedIds = (key: PreparationBucket) => {
    const shipments =
      summary.data?.buckets.find((entry) => entry.bucket === key)?.shipments ??
      [];
    const selected = selections[key];

    if (!SELECTABLE_BUCKETS.has(key)) {
      return [];
    }

    // 합칠 주문은 합치는 게 목적이라, 따로 보낼 상자는 사람이 하나씩 고른다
    return selected === undefined
      ? key === 'mergeable'
        ? []
        : bulkSelectableShipments(shipments).map(
            (shipment) => shipment.shipmentId
          )
      : shipments
          .filter((shipment) => selected.includes(shipment.shipmentId))
          .map((shipment) => shipment.shipmentId);
  };

  const toggle = (id: string, checked: boolean) => {
    if (!activeBucket) {
      return;
    }

    const ids = selectedIds(activeBucket);

    if (checked && ids.length >= PREPARATION_BATCH_LIMIT) {
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

  const toggleAll = (checked: boolean) => {
    if (!activeBucket) {
      return;
    }

    const shipments = bucket?.shipments ?? [];
    // 결품으로 돌아온 상자는 하나씩 고른 것이라 전체 선택·해제가 건드리지 않는다
    const returned = new Set(
      shipments
        .filter((shipment) => shipment.shortPick)
        .map((shipment) => shipment.shipmentId)
    );
    const kept = selectedIds(activeBucket).filter((id) => returned.has(id));

    setSelections((previous) => ({
      ...previous,
      [activeBucket]: [
        ...kept,
        ...(checked
          ? bulkSelectableShipments(shipments)
              .slice(0, PREPARATION_BATCH_LIMIT - kept.length)
              .map((shipment) => shipment.shipmentId)
          : []),
      ],
    }));
  };

  const shipmentsOf = (key: PreparationBucket, ids: string[]) =>
    summary.data?.buckets
      .find((entry) => entry.bucket === key)
      ?.shipments.filter((shipment) => ids.includes(shipment.shipmentId)) ?? [];

  const prepare = (
    key: 'ready' | 'resume' | 'mergeable',
    chosen?: PreparationShipmentDto[]
  ) => {
    const ids = chosen
      ? chosen.map((shipment) => shipment.shipmentId)
      : selectedIds(key);

    if (!canPrepare || busy || ids.length === 0) {
      return;
    }

    if (pickingMethod === 'multi_order' && ids.length > Number(cartCapacity)) {
      toast.error(`카트 용량 ${cartCapacity}건까지만 고를 수 있어요`);

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
      shipments: chosen ?? shipmentsOf(key, ids),
      source: key,
    });
  };

  // 나누면 원본 상자에 예약분이 남아 같은 id 로 완전출고가 된다. 상태는 출고 준비가 상자마다 다시 검사하므로
  // 새 요약을 기다리지 않고 나눈 상자 그대로 확인 창을 연다(목록 첫 페이지 밖에 있어도 빠지지 않는다).
  const prepareSplit = () => {
    if (!splitDone) {
      return;
    }

    const ids = splitDone.shipments.map((shipment) => shipment.shipmentId);

    setSplitDone(null);
    setActiveBucket('ready');
    setSelections((previous) => ({ ...previous, ready: ids }));
    prepare('ready', splitDone.shipments);
  };

  const splitShipments = async (shipmentIds: string[]) => {
    if (
      !canRun(useSplitUnreservedMany) ||
      splitRunning.current ||
      shipmentIds.length === 0
    ) {
      return;
    }

    splitRunning.current = true;
    setSplitting(true);
    // 실패해 다시 눌러도 창에서 뺀 상자가 되살아나지 않는다
    setSelections((previous) => ({ ...previous, partial: shipmentIds }));

    const before = shipmentsOf('partial', shipmentIds);

    if (
      !splitCommand.current ||
      splitCommand.current.data.shipmentIds.join(',') !== shipmentIds.join(',')
    ) {
      splitCommand.current = createIdempotentCommand({ shipmentIds });
    }

    try {
      const command = splitCommand.current;
      const result = await retryTransientBulk(
        (ids) => split.mutateAsync({ ...command, data: { shipmentIds: ids } }),
        shipmentIds,
        (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      );

      splitCommand.current = null;
      setSplitDone({
        shipments: before.filter((shipment) =>
          result.succeeded.includes(shipment.shipmentId)
        ),
        failedCount: result.failed.length,
      });

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
        {(holderOptions.length > 1 || holderFilter.length > 0) && (
          <div className="space-y-1.5">
            <span className="text-sm font-medium leading-none">화주</span>
            <div
              role="group"
              aria-label="화주"
              className="flex flex-wrap gap-1.5"
            >
              <Button
                type="button"
                size="sm"
                variant={holderFilter.length === 0 ? 'default' : 'outline'}
                aria-pressed={holderFilter.length === 0}
                disabled={busy}
                onClick={() => pickHolders([])}
              >
                전체
              </Button>
              {holderOptions.map((holder) => {
                const on = holderFilter.includes(holder.key);

                return (
                  <Button
                    key={holder.key}
                    type="button"
                    size="sm"
                    variant={on ? 'default' : 'outline'}
                    aria-pressed={on}
                    disabled={busy}
                    onClick={() =>
                      pickHolders(
                        on
                          ? holderFilter.filter((key) => key !== holder.key)
                          : [...holderFilter, holder.key]
                      )
                    }
                  >
                    {holder.name} {holder.count}
                  </Button>
                );
              })}
            </div>
          </div>
        )}
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
            {targetNotice ? (
              <p
                role="status"
                className="text-sm font-semibold text-foreground"
              >
                {targetNotice}
              </p>
            ) : null}
            <BucketTable
              summary={summary.data}
              busy={busy}
              canPrepare={canPrepare}
              selectedCount={(key) => selectedIds(key).length}
              onView={(key) => {
                setTargetNotice(null);
                setActiveBucket(key);
              }}
              onPrepare={prepare}
              onSplit={() => setConfirmingSplit(selectedIds('partial'))}
              holders={holderFilter}
            />
            {bucket && (
              <BucketList
                bucket={bucket}
                warehouseId={warehouseId}
                selectedIds={selectedIds(bucket.bucket)}
                busy={busy}
                onToggle={toggle}
                onToggleAll={toggleAll}
                onMerge={setSheetShipmentId}
                canPrepare={canPrepare}
                onPrepareSeparately={() => prepare('mergeable')}
              />
            )}
          </>
        )
      )}
      {confirmingSplit && (
        <SplitConfirmDialog
          shipments={shipmentsOf('partial', confirmingSplit)}
          onClose={() => setConfirmingSplit(null)}
          onConfirm={(ids) => void splitShipments(ids)}
        />
      )}
      {splitDone && (
        <SplitResultDialog
          shipments={splitDone.shipments}
          failedCount={splitDone.failedCount}
          canPrepare={canPrepare}
          onPrepare={prepareSplit}
          onShowWaiting={() => {
            setSplitDone(null);
            setActiveBucket('unavailable');
          }}
          onClose={() => setSplitDone(null)}
        />
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
          onPrepare={(shipmentId) => {
            setSheetShipmentId('');
            setTarget(shipmentId);
          }}
        />
      )}
    </div>
  );
}
