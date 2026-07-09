'use client';

import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, PackageCheck } from 'lucide-react';
import {
  useDeliverFulfillment,
  orderQueryKeys,
} from '@/lib/services/orders';
import type { FulfillmentOrderDetail } from '@/lib/types/dto/fulfillment';

function extractErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const axiosErr = err as { response?: { data?: { message?: string | string[] } } };
    const msg = axiosErr.response?.data?.message;
    if (Array.isArray(msg)) return msg.join(', ');
    if (typeof msg === 'string') return msg;
  }
  return '알 수 없는 오류가 발생했습니다.';
}

export function ShipmentTab({ fo }: { fo: FulfillmentOrderDetail }) {
  const queryClient = useQueryClient();
  const canDeliver = fo.adminAvailableActions.includes('deliver');

  const deliver = useDeliverFulfillment(fo.id);

  const handleDeliver = async () => {
    try {
      await deliver.mutateAsync();
      await queryClient.invalidateQueries({ queryKey: orderQueryKeys.fulfillment(fo.id) });
      toast.success('배송 완료(고객 수령) 처리되었습니다. FO 상태가 completed로 전환됩니다.');
    } catch (err) {
      toast.error(`배송 완료 처리 실패: ${extractErrorMessage(err)}`);
    }
  };

  return (
    <div className="flex flex-col gap-8 py-4">
      {/* 현재 송장/운송장 정보 */}
      <section>
        <h3 className="mb-3 text-sm font-semibold">현재 송장 / 운송장 정보</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {fo.invoice ? (
            <div className="rounded-md border p-3 text-sm">
              <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">송장</p>
              <p>번호: <span className="font-mono">{fo.invoice.invoiceNumber}</span></p>
              <p>상태: <Badge variant="secondary" className="font-mono text-xs ml-1">{fo.invoice.status}</Badge></p>
              {fo.invoice.carrierCode && <p>택배사: {fo.invoice.carrierCode}</p>}
              <p>발행 방식: {fo.invoice.issueMethod}</p>
            </div>
          ) : (
            <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              <p className="text-xs font-semibold uppercase mb-1">송장</p>
              <p>미등록</p>
            </div>
          )}

          {fo.shipment ? (
            <div className="rounded-md border p-3 text-sm">
              <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">운송장</p>
              <p>추적번호: <span className="font-mono">{fo.shipment.trackingNo}</span></p>
              <p>택배사: {fo.shipment.carrier}</p>
              <p>상태: <Badge variant="secondary" className="font-mono text-xs ml-1">{fo.shipment.status}</Badge></p>
              {fo.shipment.eta && <p>예상 도착: {fo.shipment.eta}</p>}
              {fo.shipment.invoiceUrl && (
                <a
                  href={fo.shipment.invoiceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline"
                >
                  송장 URL
                </a>
              )}
            </div>
          ) : (
            <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              <p className="text-xs font-semibold uppercase mb-1">운송장</p>
              <p>미등록</p>
            </div>
          )}
        </div>
      </section>

      {/* 배송 완료 (deliver) — 고객 수령 확인 */}
      <section className="rounded-md border p-4">
        <div className="mb-2 flex items-center gap-2">
          <PackageCheck className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">배송 완료 처리 (고객 수령 확인)</h3>
          <Badge variant="outline" className="text-xs">deliver</Badge>
        </div>
        <p className="mb-2 text-xs text-muted-foreground">
          고객이 상품을 실제로 수령했음을 확인할 때 실행합니다.
          FO 상태가 <span className="font-mono font-medium">completed</span>로 전환되고
          <span className="font-mono"> FulfillmentDelivered</span> 이벤트가 발행됩니다.
        </p>
        <Alert className="mb-3">
          <AlertTriangle />
          <AlertDescription>
            배송 완료는 출고 완료(ship)와 다릅니다. 출고 완료 이후에만 실행 가능하며,
            고객 수령 단계입니다. 직배(drop_ship) FO의 공급사 출고 완료와도 다릅니다.
          </AlertDescription>
        </Alert>
        {!canDeliver && (
          <p className="mb-2 text-xs text-muted-foreground">
            현재 FO 상태({fo.status})에서는 배송 완료 처리가 허용되지 않습니다.
            배송 완료는 출고 완료(shipped) 상태 이후에만 가능합니다.
          </p>
        )}
        <Button
          variant="default"
          onClick={handleDeliver}
          disabled={!canDeliver || deliver.isPending}
        >
          {deliver.isPending ? '처리 중...' : '배송 완료 처리 (고객 수령)'}
        </Button>
      </section>
    </div>
  );
}
