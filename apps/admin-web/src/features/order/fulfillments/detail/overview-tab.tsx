'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FoStatusBadge } from '../components/fo-status-badge';
import type { FulfillmentOrderDetail, FulfillmentMode, FulfillmentOrderPriority } from '@/lib/types/dto/fulfillment';

const MODE_LABELS: Record<FulfillmentMode, string> = {
  in_house: '자체배송',
  '3pl': '3PL',
  drop_ship: '직배',
};

const PRIORITY_LABELS: Record<FulfillmentOrderPriority, string> = {
  normal: '일반',
  high: '높음',
  urgent: '긴급',
};

const PRIORITY_VARIANTS: Record<FulfillmentOrderPriority, 'default' | 'secondary' | 'destructive'> = {
  normal: 'secondary',
  high: 'default',
  urgent: 'destructive',
};

const DIRECT_SHIP_LABELS: Record<string, string> = {
  pending: '대기',
  forwarded: '발송됨',
  completed: '공급사 출고 완료',
  canceled: '취소',
};

function KVRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 border-b px-4 py-2.5 last:border-b-0">
      <div className="text-sm font-medium text-muted-foreground">{label}</div>
      <div className="col-span-2 text-sm">{children}</div>
    </div>
  );
}

function MonoId({ id }: { id: string }) {
  return <span className="font-mono text-xs">{id}</span>;
}

export function OverviewTab({ fo }: { fo: FulfillmentOrderDetail }) {
  return (
    <div className="flex flex-col gap-4 py-4">
      {/* 기본 정보 */}
      <section className="rounded-md border">
        <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground bg-muted/40">
          FO 정보
        </div>
        <KVRow label="FO ID">
          <MonoId id={fo.id} />
        </KVRow>
        <KVRow label="상태">
          <FoStatusBadge status={fo.status} />
        </KVRow>
        <KVRow label="우선순위">
          <Badge variant={PRIORITY_VARIANTS[fo.priority]}>
            {PRIORITY_LABELS[fo.priority]}
          </Badge>
        </KVRow>
        <KVRow label="모드">
          {fo.fulfillmentMode ? MODE_LABELS[fo.fulfillmentMode] : '-'}
        </KVRow>
        <KVRow label="창고 ID">
          {fo.warehouseId ? <MonoId id={fo.warehouseId} /> : '-'}
        </KVRow>
        <KVRow label="생성일">
          {new Date(fo.createdAt).toLocaleString('ko-KR')}
        </KVRow>
        {fo.allocatedAt && (
          <KVRow label="할당일">
            {new Date(fo.allocatedAt).toLocaleString('ko-KR')}
          </KVRow>
        )}
        {fo.shippedAt && (
          <KVRow label="출고 완료일">
            {new Date(fo.shippedAt).toLocaleString('ko-KR')}
          </KVRow>
        )}
        {fo.canceledAt && (
          <KVRow label="취소일">
            {new Date(fo.canceledAt).toLocaleString('ko-KR')}
          </KVRow>
        )}
        {fo.labelNo && (
          <KVRow label="라벨 번호">
            <MonoId id={fo.labelNo} />
          </KVRow>
        )}
      </section>

      {/* 판매 주문 */}
      <section className="rounded-md border">
        <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground bg-muted/40">
          판매 주문
        </div>
        <KVRow label="판매주문 ID">
          {fo.salesOrderId ? <MonoId id={fo.salesOrderId} /> : '-'}
        </KVRow>
      </section>

      {/* 배치 */}
      <section className="rounded-md border">
        <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground bg-muted/40">
          출고 배치
        </div>
        <KVRow label="배치 ID">
          {fo.batch ? (
            <Button asChild variant="link" className="h-auto p-0 font-mono text-xs">
              <Link href={`/order/outbound-batches?batchId=${fo.batch.id}`}>{fo.batch.id}</Link>
            </Button>
          ) : '-'}
        </KVRow>
        {fo.batch && (
          <KVRow label="배치 번호">
            <span className="font-mono text-xs">{fo.batch.batchNumber}</span>
          </KVRow>
        )}
      </section>

      {/* 송장 */}
      <section className="rounded-md border">
        <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground bg-muted/40">
          송장
        </div>
        {fo.invoice ? (
          <>
            <KVRow label="송장 ID">
              <Button asChild variant="link" className="h-auto p-0 font-mono text-xs">
                <Link href="/order/shipment-round">{fo.invoice.id}</Link>
              </Button>
            </KVRow>
            <KVRow label="송장 번호">
              <span className="font-mono text-xs">{fo.invoice.invoiceNumber}</span>
            </KVRow>
            <KVRow label="발행 방법">
              {fo.invoice.issueMethod}
            </KVRow>
            <KVRow label="상태">
              <span>{fo.invoice.status}</span>
            </KVRow>
            {fo.invoice.carrierCode && (
              <KVRow label="운송사">{fo.invoice.carrierCode}</KVRow>
            )}
          </>
        ) : (
          <KVRow label="송장">-</KVRow>
        )}
      </section>

      {/* 배송 */}
      <section className="rounded-md border">
        <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground bg-muted/40">
          배송 (Shipment)
        </div>
        {fo.shipment ? (
          <>
            <KVRow label="운송장 번호">
              <span className="font-mono text-xs">{fo.shipment.trackingNo}</span>
            </KVRow>
            <KVRow label="배송사">{fo.shipment.carrier}</KVRow>
            <KVRow label="배송 상태">{fo.shipment.status}</KVRow>
            {fo.shipment.eta && (
              <KVRow label="예상 도착">
                {new Date(fo.shipment.eta).toLocaleDateString('ko-KR')}
              </KVRow>
            )}
          </>
        ) : (
          <KVRow label="배송">-</KVRow>
        )}
      </section>

      {/* 직배 */}
      {fo.fulfillmentMode === 'drop_ship' && (
        <section className="rounded-md border">
          <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground bg-muted/40">
            직배 (Drop Ship)
          </div>
          <KVRow label="직배 상태">
            {fo.directShipStatus ? (
              <>
                <span className="mr-2">{DIRECT_SHIP_LABELS[fo.directShipStatus] ?? fo.directShipStatus}</span>
                <Button asChild variant="link" className="h-auto p-0 text-xs">
                  <Link href={`/order/direct-ship?foId=${fo.id}`}>직배송 운영 화면 →</Link>
                </Button>
              </>
            ) : '-'}
          </KVRow>
        </section>
      )}

      {/* 수량 요약 */}
      <section className="rounded-md border">
        <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground bg-muted/40">
          수량
        </div>
        <KVRow label="총 수량">
          <span className="tabular-nums">{fo.totalQty}</span>
        </KVRow>
        <KVRow label="예약 수량">
          <span className="tabular-nums">{fo.totalReservedQty}</span>
        </KVRow>
        <KVRow label="라인 수">
          <span className="tabular-nums">{fo.totalItems}</span>
        </KVRow>
        {fo.reservationFailureReason && (
          <KVRow label="예약 실패 사유">
            <span className="text-destructive">{fo.reservationFailureReason}</span>
          </KVRow>
        )}
      </section>

      {/* adminAvailableActions */}
      <section className="rounded-md border">
        <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground bg-muted/40">
          가능한 운영 액션
        </div>
        <div className="flex flex-wrap gap-2 p-4">
          {fo.adminAvailableActions.length > 0 ? (
            fo.adminAvailableActions.map((action) => (
              <Badge key={action} variant="outline" className="font-mono text-xs">
                {action}
              </Badge>
            ))
          ) : (
            <span className="text-sm text-muted-foreground">없음</span>
          )}
        </div>
        {fo.blockedReasons.length > 0 && (
          <div className="border-t px-4 py-3">
            <p className="mb-2 text-xs font-semibold text-destructive">차단 사유</p>
            <ul className="space-y-1">
              {fo.blockedReasons.map((reason, i) => (
                <li key={i} className="text-sm text-destructive">
                  {reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
