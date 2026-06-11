'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { useCheckFulfillmentAvailability } from '@/lib/services/orders';
import { ReserveDialog } from './reserve-dialog';
import { UnreserveDialog } from './unreserve-dialog';
import { TransferDialog } from './transfer-dialog';
import type { FulfillmentOrderDetail } from '@/lib/types/dto/fulfillment';

function truncateId(id: string) {
  return `${id.substring(0, 8)}…`;
}

type AvailabilityResult = { ready: boolean } | null;

export function InventoryTab({ fo }: { fo: FulfillmentOrderDetail }) {
  const canReserve = fo.adminAvailableActions.includes('reserve');
  const canUnreserve = fo.adminAvailableActions.includes('unreserve');
  const canTransfer = fo.adminAvailableActions.includes('transferReservation');

  const checkAvailability = useCheckFulfillmentAvailability(fo.id);
  const [availabilityResult, setAvailabilityResult] = useState<AvailabilityResult>(null);

  const [reserveOpen, setReserveOpen] = useState(false);
  const [unreserveOpen, setUnreserveOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  const handleCheckAvailability = async () => {
    try {
      const result = await checkAvailability.mutateAsync();
      const res = result as { ready: boolean };
      setAvailabilityResult(res);
      if (res.ready) {
        toast.success('재고 확인: 이 FO를 이행하기에 충분한 재고가 있습니다.');
      } else {
        toast.warning('재고 확인: 재고 부족 — 일부 아이템을 이행할 수 없습니다.');
      }
    } catch {
      toast.error('재고 가용 확인 실패');
    }
  };

  return (
    <div className="flex flex-col gap-6 py-4">
      {/* blockedReasons */}
      {fo.blockedReasons.length > 0 && (
        <Alert>
          <AlertTriangle />
          <AlertTitle>차단 사유</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-0.5 pl-4">
              {fo.blockedReasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* 재고 가용 확인 */}
      <section>
        <div className="mb-2 flex items-center gap-3">
          <h3 className="text-sm font-semibold">재고 가용 확인</h3>
          <Button
            size="sm"
            variant="outline"
            onClick={handleCheckAvailability}
            disabled={checkAvailability.isPending}
          >
            {checkAvailability.isPending ? '확인 중...' : '재고 가용 확인'}
          </Button>
          {availabilityResult !== null && (
            availabilityResult.ready ? (
              <Badge variant="secondary" className="gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" />
                재고 충분
              </Badge>
            ) : (
              <Badge variant="destructive" className="gap-1">
                <XCircle className="h-3.5 w-3.5" />
                재고 부족
              </Badge>
            )
          )}
        </div>
      </section>

      {/* FOI별 예약 현황 */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">아이템별 예약 현황</h3>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="default"
              onClick={() => setReserveOpen(true)}
              disabled={!canReserve}
              title={!canReserve ? '이 FO 상태에서는 재고 예약을 실행할 수 없습니다.' : undefined}
            >
              재고 예약
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setUnreserveOpen(true)}
              disabled={!canUnreserve}
              title={!canUnreserve ? '출고 수량이 있거나 terminal 상태에서는 예약 해제가 불가합니다.' : undefined}
            >
              예약 해제
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setTransferOpen(true)}
              disabled={!canTransfer}
              title={!canTransfer ? '피킹이 시작된 출고주문은 예약을 이전할 수 없습니다. (허용 상태: created / reserving / ready / unfulfillable)' : undefined}
            >
              예약 이전
            </Button>
          </div>
        </div>

        {!canReserve && (
          <p className="mb-2 text-xs text-muted-foreground">
            재고 예약 비활성: 현재 FO 상태({fo.status})에서는 예약이 허용되지 않습니다.
            {fo.adminAvailableActions.length > 0 &&
              ` 가능한 액션: ${fo.adminAvailableActions.join(', ')}`}
          </p>
        )}

        <div className="overflow-auto rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>FOI ID</TableHead>
                <TableHead>SKU ID</TableHead>
                <TableHead className="text-right">필요 수량</TableHead>
                <TableHead className="text-right">예약됨</TableHead>
                <TableHead className="text-right">
                  <span title="qty - reservedQty">미예약 (부족)</span>
                </TableHead>
                <TableHead className="text-right">출고됨</TableHead>
                <TableHead>상태</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fo.items.map((item) => {
                const shortage = item.qty - item.reservedQty;
                const hasShipped = item.shippedQty > 0;
                return (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {truncateId(item.id)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {truncateId(item.skuId)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{item.qty}</TableCell>
                    <TableCell className="text-right tabular-nums">{item.reservedQty}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {shortage > 0 ? (
                        <Badge variant="destructive" className="tabular-nums">
                          {shortage}
                        </Badge>
                      ) : (
                        <span>0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {hasShipped ? (
                        <Badge variant="secondary" className="tabular-nums">
                          {item.shippedQty}
                        </Badge>
                      ) : (
                        0
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-mono text-xs">
                        {item.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* 예약 현황 (from FO detail reservations) */}
      <section>
        <h3 className="mb-2 text-sm font-semibold">
          재고 예약 목록
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            (배치 할당과 구분 — 재고 잠금 레코드)
          </span>
        </h3>
        {fo.reservations.length === 0 ? (
          <p className="text-sm text-muted-foreground">예약 레코드 없음</p>
        ) : (
          <div className="overflow-auto rounded border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>예약 ID</TableHead>
                  <TableHead>FOI ID</TableHead>
                  <TableHead>SKU ID</TableHead>
                  <TableHead>창고 ID</TableHead>
                  <TableHead className="text-right">수량</TableHead>
                  <TableHead>상태</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fo.reservations.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {truncateId(r.id)}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {r.fulfillmentOrderItemId ? truncateId(r.fulfillmentOrderItemId) : '-'}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {truncateId(r.skuId)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {truncateId(r.warehouseId)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.quantity}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-mono text-xs">
                        {r.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <ReserveDialog
        foId={fo.id}
        items={fo.items}
        open={reserveOpen}
        onOpenChange={setReserveOpen}
      />
      <UnreserveDialog
        foId={fo.id}
        items={fo.items}
        canUnreserve={canUnreserve}
        open={unreserveOpen}
        onOpenChange={setUnreserveOpen}
      />
      <TransferDialog
        foId={fo.id}
        items={fo.items}
        canTransfer={canTransfer}
        open={transferOpen}
        onOpenChange={setTransferOpen}
      />
    </div>
  );
}
