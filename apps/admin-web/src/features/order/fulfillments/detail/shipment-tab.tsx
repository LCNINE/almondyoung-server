'use client';

import { useState } from 'react';
import { AlertTriangle, PackageOpen } from 'lucide-react';
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
import {
  getServerDenyMessage,
  isRecoverableOperation,
  useFulfillmentShipments,
  useShipmentDetail,
} from '@/lib/services/orders';
import type {
  FulfillmentOrderDetail,
  ShipmentAdminDetail,
} from '@/lib/types/dto/fulfillment';
import { useChannelDispatchViewModel } from './channel-dispatch-query';
import {
  ChannelDispatchAlerts,
  ChannelDispatchAttemptStatus,
} from './channel-dispatch-status';
import { ShipmentActions } from './shipment-actions';

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

function shortId(value: string | null | undefined) {
  if (!value) return '-';
  return `${value.slice(0, 8)}…`;
}

function when(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString('ko-KR') : '-';
}

function ShipmentDetailView({ shipment }: { shipment: ShipmentAdminDetail }) {
  const operations = shipment.operations ?? [];
  const invoices = shipment.invoices ?? [];
  const attempts = shipment.dispatchAttempts ?? [];
  const channelDispatch = useChannelDispatchViewModel(shipment);

  return (
    <div className="space-y-6">
      <ChannelDispatchAlerts viewModel={channelDispatch} />

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-mono text-sm font-semibold">{shipment.id}</h3>
            <p className="text-xs text-muted-foreground">
              manifest v{shipment.manifestVersion} · reservation v
              {shipment.reservationVersion} · 창고{' '}
              {shortId(shipment.warehouseId)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={STATUS_VARIANT(shipment.status)}>
              {shipment.status}
            </Badge>
            {shipment.recoveryCode && (
              <Badge variant="destructive">{shipment.recoveryCode}</Badge>
            )}
          </div>
        </div>
        <ShipmentActions shipment={shipment} />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">
          shipment 라인 / 진행 수량
        </h3>
        <div className="overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>라인</TableHead>
                <TableHead>원본 주문</TableHead>
                <TableHead className="text-right">수량</TableHead>
                <TableHead className="text-right">예약</TableHead>
                <TableHead className="text-right">검수</TableHead>
                <TableHead className="text-right">버전</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shipment.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>
                    <p className="font-mono text-xs">{shortId(line.id)}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      SKU {shortId(line.skuId)}
                    </p>
                  </TableCell>
                  <TableCell className="text-xs">
                    {line.origin ? (
                      <>
                        <p>
                          {line.origin.salesChannel} ·{' '}
                          {shortId(line.origin.salesOrderId)}
                        </p>
                        <p className="text-muted-foreground">
                          item {shortId(line.origin.channelOrderItemId)}
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
                    {line.reservedQty}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {line.inspectedQty}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    v{line.lineVersion}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">
          송장 이력 ({invoices.length})
        </h3>
        {invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            발행된 송장이 없습니다.
          </p>
        ) : (
          <div className="divide-y rounded-md border text-sm">
            {invoices.map((invoice) => (
              <div key={invoice.id} className="grid gap-2 p-3 sm:grid-cols-4">
                <span className="font-mono text-xs">{shortId(invoice.id)}</span>
                <span className="font-mono text-xs">
                  {invoice.trackingNo || '-'}
                </span>
                <Badge
                  variant={STATUS_VARIANT(invoice.status)}
                  className="w-fit"
                >
                  {invoice.status}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  발행 {when(invoice.issuedAt)} · void {when(invoice.voidedAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">
          출고 attempt / 운송 추적 ({attempts.length})
        </h3>
        {attempts.length === 0 ? (
          <p className="text-sm text-muted-foreground">출고 시도가 없습니다.</p>
        ) : (
          <div className="space-y-3">
            {attempts.map((attempt) => (
              <div key={attempt.id} className="rounded-md border p-3 text-sm">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-semibold">
                      시도 #{attempt.attemptNo}
                    </span>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      {shortId(attempt.id)}
                    </span>
                  </div>
                  <Badge variant={STATUS_VARIANT(attempt.status)}>
                    {attempt.status}
                  </Badge>
                </div>
                <ChannelDispatchAttemptStatus
                  attemptId={attempt.id}
                  viewModel={channelDispatch}
                />
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <p className="mb-1 text-xs font-medium">실제 출고 source</p>
                    {(attempt.sources ?? []).map((source) => (
                      <p
                        key={source.id}
                        className="font-mono text-xs text-muted-foreground"
                      >
                        line {shortId(source.shipmentLineId)} · location{' '}
                        {shortId(source.sourceLocationId)} · {source.quantity}개
                      </p>
                    ))}
                    {(attempt.sources?.length ?? 0) === 0 && (
                      <p className="text-xs text-muted-foreground">
                        source 기록 없음
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-medium">tracking history</p>
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
                        추적 이벤트 없음
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
          durable operation 이력 ({operations.length})
        </h3>
        <div className="divide-y rounded-md border">
          {operations.map((operation) => (
            <div
              key={operation.operationId}
              className="flex flex-wrap items-center justify-between gap-2 p-3 text-xs"
            >
              <div>
                <p className="font-medium">
                  {operation.type} · {shortId(operation.operationId)}
                </p>
                <p className="text-muted-foreground">
                  {when(operation.createdAt)}
                  {operation.lastError ? ` · ${operation.lastError}` : ''}
                </p>
              </div>
              <Badge
                variant={
                  isRecoverableOperation(operation.status)
                    ? 'secondary'
                    : STATUS_VARIANT(operation.status)
                }
              >
                {operation.status}
              </Badge>
            </div>
          ))}
          {operations.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">
              operation 기록 없음
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

export function ShipmentTab({ fo }: { fo: FulfillmentOrderDetail }) {
  const [requestedShipmentId, setRequestedShipmentId] = useState('');
  const shipments = useFulfillmentShipments(fo.id);
  const selectedShipmentId = shipments.data?.some(
    (shipment) => shipment.id === requestedShipmentId
  )
    ? requestedShipmentId
    : (shipments.data?.[0]?.id ?? '');
  const detail = useShipmentDetail(selectedShipmentId);

  if (shipments.isLoading)
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        shipment 목록을 불러오는 중입니다.
      </p>
    );
  if (shipments.isError) {
    return (
      <Alert variant="destructive" className="my-4">
        <AlertTriangle />
        <AlertDescription>
          {getServerDenyMessage(
            shipments.error,
            'shipment 목록 조회에 실패했습니다.'
          )}
        </AlertDescription>
      </Alert>
    );
  }
  if (!shipments.data?.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
        <PackageOpen className="h-6 w-6" />
        <p className="text-sm">이 FO에 연결된 shipment가 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-5 py-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="space-y-2">
        <h3 className="text-sm font-semibold">
          shipment 목록 ({shipments.data.length})
        </h3>
        {shipments.data.map((shipment) => (
          <Button
            key={shipment.id}
            variant={
              shipment.id === selectedShipmentId ? 'secondary' : 'outline'
            }
            className="h-auto w-full justify-start p-3 text-left"
            onClick={() => setRequestedShipmentId(shipment.id)}
          >
            <span className="min-w-0">
              <span className="block truncate font-mono text-xs">
                {shipment.id}
              </span>
              <span className="mt-1 block text-xs font-normal text-muted-foreground">
                {shipment.status} · {shipment.totalQty}개 · 예약{' '}
                {shipment.reservedQty} · M{shipment.manifestVersion}/R
                {shipment.reservationVersion}
              </span>
            </span>
          </Button>
        ))}
      </aside>
      <main className="min-w-0">
        {detail.isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            shipment 상세를 불러오는 중입니다.
          </p>
        ) : detail.isError ? (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertDescription>
              {getServerDenyMessage(
                detail.error,
                'shipment 상세 조회에 실패했습니다.'
              )}
            </AlertDescription>
          </Alert>
        ) : detail.data ? (
          <ShipmentDetailView shipment={detail.data} />
        ) : null}
      </main>
    </div>
  );
}
