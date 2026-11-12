'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  PackageOpen,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { siteLabel } from '@/lib/api/domains/sales-channel/vocabulary';
import { useSuppliers } from '@/lib/services/inventory/queries';
import { directDeliverySuppliers } from '@/lib/utils/direct-delivery-suppliers';
import {
  getServerDenyMessage,
  isRecoverableOperation,
  useFulfillmentShipments,
  useShipmentDetail,
} from '@/lib/services/orders';
import {
  useConsolidationProgress,
  useConsolidationProgresses,
} from '@/lib/services/orders/queries';
import type {
  ConsolidationProgressResponse,
  FulfillmentOrderDetail,
  ShipmentAdminDetail,
  ShipmentAdminSummary,
} from '@/lib/types/dto/fulfillment';
import { useChannelDispatchViewModel } from './channel-dispatch-query';
import { ConsolidationProgressPanel } from './consolidation-progress-panel';
import {
  ChannelDispatchAlerts,
  ChannelDispatchAttemptStatus,
} from './channel-dispatch-status';
import { ShipmentActions } from './shipment-actions';
import { lineOrderNo, splitLineName } from './shipment-split-model';
import {
  dispatchAttemptLabel,
  operationStatusLabel,
} from './shipment-action-copy';
import {
  carrierLabel,
  dispatchAttemptStatusLabel,
  operationTypeLabel,
  recoveryLabel,
  shipmentStatusLabel,
  waybillStatusLabel,
} from './fulfillment-labels';
import {
  orderShipments,
  ownerLabel,
  showsWaybillActions,
} from './shipment-owner';
import { WaybillActions } from './waybill-actions';
import { StuckWaybillPanel } from './stuck-waybill-panel';

const STATUS_VARIANT = (
  status: string
): 'default' | 'secondary' | 'destructive' | 'outline' => {
  if (
    status === 'recovery_required' ||
    status === 'failed' ||
    status === 'manual_adjustment_required'
  ) {
    return 'destructive';
  }
  if (status === 'pending' || status === 'in_progress' || status === 'draft')
    return 'secondary';
  return 'outline';
};

/** 상자 이름. 같은 출고주문 안의 상자를 가르는 짧은 번호다 */
function boxName(id: string) {
  return `상자 ${id.slice(0, 8)}`;
}

// 계획 전·계획 확정 상자만 재고 확보가 진행 중이다. 출고 뒤에는 확보가 풀리는 게 정상이다
const RESERVING_STATUSES = new Set(['draft', 'planned']);

function when(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString('ko-KR') : '-';
}

// 합포장 중에는 배치에서 빠진 뒤에만 운송장을 취소해야 해서 진행 안내의 버튼으로만 받는다.
// 진행 상태를 모르면 열지 않는다 — 조회가 끝나 합포장이 없다고 확인된 뒤에만 무효화·재발급을 연다.
function waybillVoidLockReason(
  consolidation: {
    data: ConsolidationProgressResponse | null | undefined;
    isSuccess: boolean;
    isError: boolean;
  },
  shipmentId: string
): string | null {
  if (consolidation.isError) {
    return '합포장 진행 상태를 확인하지 못했어요. 새로고침해 주세요';
  }

  if (!consolidation.isSuccess) {
    return '합포장 진행 상태를 확인하는 중이에요';
  }

  const isPendingSource =
    consolidation.data?.status === 'pending' &&
    consolidation.data.sources.some(
      (source) => source.shipmentId === shipmentId
    );

  return isPendingSource
    ? '합포장 진행 중에는 위 진행 안내에서 운송장을 취소해요'
    : null;
}

function resolveResultBox(
  startId: string,
  progressById: Map<string, ConsolidationProgressResponse | null | undefined>,
  activeIds: Set<string>
): string | null {
  let id = startId;

  for (let hop = 0; hop <= progressById.size; hop += 1) {
    const progress = progressById.get(id);

    if (progress?.status !== 'completed' || !progress.targetShipmentId) {
      return null;
    }

    id = progress.targetShipmentId;

    if (activeIds.has(id)) {
      return id;
    }
  }

  return null;
}

function ShipmentDetailView({
  shipment,
  retiredShipmentId,
}: {
  shipment: ShipmentAdminDetail;
  retiredShipmentId?: string;
}) {
  const operations = shipment.operations ?? [];
  const waybills = shipment.waybills ?? [];
  const attempts = shipment.dispatchAttempts ?? [];
  const channelDispatch = useChannelDispatchViewModel(shipment);
  const isSupplier = !!shipment.supplierId;
  const suppliers = useSuppliers({ isDirectDelivery: true, limit: 100 });
  const supplierName = directDeliverySuppliers(suppliers.data?.data).find(
    (entry) => entry.id === shipment.supplierId
  )?.name;

  const totalQty = shipment.lines.reduce((sum, line) => sum + line.qty, 0);
  const kinds = new Set(shipment.lines.map((line) => line.skuId)).size;
  const lineName = new Map(
    shipment.lines.map((line) => [line.id, splitLineName(line)])
  );
  const orderNoOf = (salesOrderId: string) => {
    const line = shipment.lines.find(
      (entry) => entry.origin?.salesOrderId === salesOrderId
    );
    return line ? lineOrderNo(line) : null;
  };
  const consolidation = useConsolidationProgress(shipment.id);
  const voidLockedReason = waybillVoidLockReason(consolidation, shipment.id);

  return (
    <div className="space-y-6">
      <ConsolidationProgressPanel
        shipmentId={shipment.id}
        mergedFromShipmentId={
          shipment.status === 'superseded' ? undefined : retiredShipmentId
        }
        target={shipment}
      >
        <ChannelDispatchAlerts viewModel={channelDispatch} />

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">{boxName(shipment.id)}</h3>
              <p className="text-xs text-muted-foreground">
                {ownerLabel(shipment, supplierName)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={STATUS_VARIANT(shipment.status)}>
                {shipmentStatusLabel(shipment.status)}
              </Badge>
              {shipment.recoveryCode && (
                <Badge variant="destructive">
                  {recoveryLabel(shipment.recoveryCode)}
                </Badge>
              )}
            </div>
          </div>
          <ShipmentActions shipment={shipment} />
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold">
            {`담긴 상품 ${kinds}종 · ${totalQty}개`}
          </h3>
          <div className="overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>상품</TableHead>
                  <TableHead>주문</TableHead>
                  <TableHead className="text-right">수량</TableHead>
                  <TableHead className="text-right">재고 확보</TableHead>
                  <TableHead className="text-right">검수</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shipment.lines.map((line) => {
                  const orderNo = lineOrderNo(line);
                  return (
                    <TableRow key={line.id}>
                      <TableCell className="whitespace-normal break-keep font-medium">
                        {splitLineName(line)}
                      </TableCell>
                      <TableCell className="whitespace-normal text-xs">
                        {line.origin ? (
                          <>
                            <p>{orderNo ? `#${orderNo}` : '-'}</p>
                            <p className="text-muted-foreground">
                              {siteLabel(line.origin.salesChannel)}
                            </p>
                          </>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {line.qty}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {isSupplier || !RESERVING_STATUSES.has(shipment.status)
                          ? '—'
                          : line.reservedQty}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {line.inspectedQty}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold">
            운송장 이력 ({waybills.length})
          </h3>
          {showsWaybillActions(shipment) && (
            <div className="mb-3 space-y-3">
              <StuckWaybillPanel shipment={shipment} />
              <WaybillActions
                shipment={shipment}
                voidLockedReason={voidLockedReason}
              />
            </div>
          )}
          {waybills.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              발급한 운송장이 없어요.
            </p>
          ) : (
            <div className="divide-y rounded-md border text-sm">
              {waybills.map((waybill) => (
                <div key={waybill.id} className="grid gap-2 p-3 sm:grid-cols-4">
                  <span className="text-xs">
                    {carrierLabel(waybill.carrier)}
                  </span>
                  <span className="font-mono text-xs">
                    {waybill.trackingNo || '번호 없음'}
                  </span>
                  <Badge
                    variant={STATUS_VARIANT(waybill.status)}
                    className="w-fit"
                  >
                    {waybillStatusLabel(waybill.status)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    발급 {when(waybill.issuedAt)}
                    {waybill.voidedAt
                      ? ` · 무효 ${when(waybill.voidedAt)}`
                      : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold">
            출고 기록 ({attempts.length})
          </h3>
          {attempts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              아직 출고하지 않았어요.
            </p>
          ) : (
            <div className="space-y-3">
              {attempts.map((attempt) => (
                <div key={attempt.id} className="rounded-md border p-3 text-sm">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">
                      {dispatchAttemptLabel(attempt, waybills)}
                    </span>
                    <Badge variant={STATUS_VARIANT(attempt.status)}>
                      {dispatchAttemptStatusLabel(attempt.status)}
                    </Badge>
                  </div>
                  <ChannelDispatchAttemptStatus
                    attemptId={attempt.id}
                    orderNoOf={orderNoOf}
                    viewModel={channelDispatch}
                  />
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <p className="mb-1 text-xs font-medium">보낸 상품</p>
                      {(attempt.sources ?? []).map((source) => (
                        <p
                          key={source.id}
                          className="text-xs text-muted-foreground"
                        >
                          {lineName.get(source.shipmentLineId) ?? '상품'}{' '}
                          {source.quantity}개
                        </p>
                      ))}
                      {(attempt.sources?.length ?? 0) === 0 && (
                        <p className="text-xs text-muted-foreground">
                          기록된 상품이 없어요.
                        </p>
                      )}
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-medium">배송 추적</p>
                      {(attempt.trackingEvents ?? []).map((event) => (
                        <p
                          key={event.id}
                          className="text-xs text-muted-foreground"
                        >
                          {when(event.timestamp)} · {event.status}
                          {event.location ? ` · ${event.location}` : ''}
                        </p>
                      ))}
                      {(attempt.trackingEvents?.length ?? 0) === 0 && (
                        <p className="text-xs text-muted-foreground">
                          아직 배송 추적 기록이 없어요.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold">
            작업 기록 ({operations.length})
          </h3>
          <div className="divide-y rounded-md border">
            {operations.map((operation) => (
              <div
                key={operation.operationId}
                className="flex flex-wrap items-center justify-between gap-2 p-3 text-xs"
              >
                <div>
                  <p className="font-medium">
                    {operationTypeLabel(operation.type)}
                    {operation.reason ? ` · ${operation.reason}` : ''}
                  </p>
                  <p className="text-muted-foreground">
                    {when(operation.createdAt)}
                    {operation.lastError && (
                      <span title={operation.lastError}>
                        {' · 처리하지 못했어요'}
                      </span>
                    )}
                  </p>
                </div>
                <Badge
                  variant={
                    isRecoverableOperation(operation.status)
                      ? 'secondary'
                      : STATUS_VARIANT(operation.status)
                  }
                >
                  {operationStatusLabel(operation.status)}
                </Badge>
              </div>
            ))}
            {operations.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">
                작업 기록이 없어요.
              </p>
            )}
          </div>
        </section>
      </ConsolidationProgressPanel>
    </div>
  );
}

function ShipmentListButton({
  shipment,
  selected,
  onSelect,
}: {
  shipment: ShipmentAdminSummary;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <Button
      variant={selected ? 'secondary' : 'outline'}
      className="h-auto w-full justify-start p-3 text-left"
      onClick={() => onSelect(shipment.id)}
    >
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium">
          {boxName(shipment.id)}
        </span>
        <span className="mt-1 block text-xs font-normal text-muted-foreground">
          {[
            shipmentStatusLabel(shipment.status),
            `${shipment.totalQty}개`,
            RESERVING_STATUSES.has(shipment.status) &&
            shipment.reservedQty < shipment.totalQty
              ? `재고 확보 ${shipment.reservedQty}개`
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </span>
    </Button>
  );
}

export function ShipmentTab({
  fo,
  initialShipmentId,
}: {
  fo: FulfillmentOrderDetail;
  initialShipmentId?: string;
}) {
  const [requestedShipmentId, setRequestedShipmentId] = useState(
    initialShipmentId ?? ''
  );
  const shipments = useFulfillmentShipments(fo.id);
  const [retiredOpen, setRetiredOpen] = useState(false);
  const { active, retired } = orderShipments(shipments.data ?? []);
  const selectedShipmentId = shipments.data?.some(
    (shipment) => shipment.id === requestedShipmentId
  )
    ? requestedShipmentId
    : (active[0]?.id ?? retired[0]?.id ?? '');
  const selectedIsRetired = retired.some(
    (shipment) => shipment.id === selectedShipmentId
  );
  const retiredProgress = useConsolidationProgresses(
    retired.map((shipment) => shipment.id)
  );
  const progressById = new Map(
    retired.map((shipment, index) => [shipment.id, retiredProgress[index]])
  );
  const mergedFromId =
    retired.find(
      (shipment) =>
        progressById.get(shipment.id)?.status === 'completed' &&
        progressById.get(shipment.id)?.targetShipmentId === selectedShipmentId
    )?.id ?? retired[0]?.id;
  const selectedStatus = shipments.data?.find(
    (shipment) => shipment.id === selectedShipmentId
  )?.status;
  const followedId = useRef('');

  useEffect(() => {
    if (!selectedShipmentId) {
      return;
    }

    if (selectedStatus !== 'superseded') {
      followedId.current = selectedShipmentId;

      return;
    }

    if (followedId.current !== selectedShipmentId) {
      return;
    }

    const next = resolveResultBox(
      selectedShipmentId,
      progressById,
      new Set(active.map((shipment) => shipment.id))
    );

    if (!next) {
      return;
    }

    followedId.current = next;
    setRequestedShipmentId(next);
    setRetiredOpen(false);

    const url = new URL(window.location.href);

    if (url.searchParams.has('shipmentId')) {
      url.searchParams.set('shipmentId', next);
      window.history.replaceState(window.history.state, '', url);
    }
  });
  const detail = useShipmentDetail(selectedShipmentId);

  if (shipments.isLoading)
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        상자를 불러오는 중이에요.
      </p>
    );
  if (shipments.isError) {
    return (
      <Alert variant="destructive" className="my-4">
        <AlertTriangle />
        <AlertDescription>
          {getServerDenyMessage(
            shipments.error,
            '상자를 불러오지 못했어요. 새로고침해 주세요.'
          )}
        </AlertDescription>
      </Alert>
    );
  }
  if (!shipments.data?.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
        <PackageOpen className="h-6 w-6" />
        <p className="text-sm">이 출고주문에는 아직 상자가 없어요.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-5 py-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="space-y-2">
        <h3 className="text-sm font-semibold">
          상자 ({shipments.data.length})
        </h3>
        {active.map((shipment) => (
          <ShipmentListButton
            key={shipment.id}
            shipment={shipment}
            selected={shipment.id === selectedShipmentId}
            onSelect={setRequestedShipmentId}
          />
        ))}
        {retired.length > 0 && (
          <div className="space-y-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto w-full justify-start gap-1 px-1 py-1 text-xs text-muted-foreground"
              aria-expanded={retiredOpen || selectedIsRetired}
              onClick={() => setRetiredOpen((open) => !open)}
            >
              {retiredOpen || selectedIsRetired ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              {`쓰지 않는 상자 ${retired.length}개`}
            </Button>
            {(retiredOpen || selectedIsRetired) &&
              retired.map((shipment) => (
                <ShipmentListButton
                  key={shipment.id}
                  shipment={shipment}
                  selected={shipment.id === selectedShipmentId}
                  onSelect={setRequestedShipmentId}
                />
              ))}
          </div>
        )}
      </aside>
      <main className="min-w-0">
        {detail.isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            상자 정보를 불러오는 중이에요.
          </p>
        ) : detail.isError ? (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertDescription>
              {getServerDenyMessage(
                detail.error,
                '상자 정보를 불러오지 못했어요. 새로고침해 주세요.'
              )}
            </AlertDescription>
          </Alert>
        ) : detail.data ? (
          <ShipmentDetailView
            shipment={detail.data}
            retiredShipmentId={mergedFromId}
          />
        ) : null}
      </main>
    </div>
  );
}
