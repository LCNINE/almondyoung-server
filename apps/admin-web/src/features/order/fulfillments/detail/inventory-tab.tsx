'use client';

import { useState } from 'react';
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
import { AlertTriangle } from 'lucide-react';
import { FULFILLMENT_SCOPES } from '@/lib/services/orders';
import { usePermission } from '@/hooks/use-permission';
import { TransferDialog } from './transfer-dialog';
import type { FulfillmentOrderDetail } from '@/lib/types/dto/fulfillment';

function truncateId(id: string) {
  return `${id.substring(0, 8)}…`;
}

export function InventoryTab({ fo }: { fo: FulfillmentOrderDetail }) {
  const { hasScope, isPermissionLoading } = usePermission();
  const hasTransferScope =
    !isPermissionLoading &&
    !!hasScope([FULFILLMENT_SCOPES.transferReservation]);
  const canTransfer =
    hasTransferScope &&
    fo.adminAvailableActions.includes('transferReservation');

  const [transferOpen, setTransferOpen] = useState(false);

  return (
    <div className="flex flex-col gap-6 py-4">
      {/* blockedReasons */}
      {fo.blockedReasons.length > 0 && (
        <Alert>
          <AlertTriangle />
          <AlertTitle>차단 사유</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-0.5 pl-4">
              {fo.blockedReasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* FOI별 예약 현황 */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">아이템별 예약 현황</h3>
          <div className="flex gap-2">
            {hasTransferScope && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setTransferOpen(true)}
                disabled={!canTransfer}
                title={
                  !canTransfer
                    ? '피킹이 시작된 출고주문은 예약을 이전할 수 없습니다. (허용 상태: created / reserving / ready / unfulfillable)'
                    : undefined
                }
              >
                예약 이전
              </Button>
            )}
          </div>
        </div>

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
                    <TableCell className="text-right tabular-nums">
                      {item.qty}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {item.reservedQty}
                    </TableCell>
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
                      {r.fulfillmentOrderItemId
                        ? truncateId(r.fulfillmentOrderItemId)
                        : '-'}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {truncateId(r.skuId)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {truncateId(r.warehouseId)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.quantity}
                    </TableCell>
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

      {hasTransferScope && (
        <TransferDialog
          foId={fo.id}
          items={fo.items}
          canTransfer={canTransfer}
          open={transferOpen}
          onOpenChange={setTransferOpen}
        />
      )}
    </div>
  );
}
