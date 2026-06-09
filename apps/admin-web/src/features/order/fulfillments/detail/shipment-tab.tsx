'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, Truck, PackageCheck } from 'lucide-react';
import {
  useAssignFulfillmentShipment,
  useShipFulfillment,
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
  const canAssign = fo.adminAvailableActions.includes('assignShipment');
  const canShip = fo.adminAvailableActions.includes('ship');
  const canDeliver = fo.adminAvailableActions.includes('deliver');

  const [trackingNo, setTrackingNo] = useState('');
  const [eta, setEta] = useState('');

  const assignShipment = useAssignFulfillmentShipment(fo.id);
  const ship = useShipFulfillment(fo.id);
  const deliver = useDeliverFulfillment(fo.id);

  const handleAssignShipment = async () => {
    if (!trackingNo.trim()) {
      toast.error('운송장 번호를 입력하세요.');
      return;
    }
    try {
      await assignShipment.mutateAsync({
        trackingNo: trackingNo.trim(),
        eta: eta.trim() || undefined,
      });
      toast.success('운송장 정보가 등록되었습니다.');
      setTrackingNo('');
      setEta('');
    } catch (err) {
      toast.error(`운송장 등록 실패: ${extractErrorMessage(err)}`);
    }
  };

  const handleShip = async () => {
    try {
      await ship.mutateAsync();
      toast.success('출고 완료 처리되었습니다. FO 상태가 shipped로 전환됩니다.');
    } catch (err) {
      toast.error(`출고 완료 처리 실패: ${extractErrorMessage(err)}`);
    }
  };

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

      {/* 운송장 등록 (assignShipment) */}
      <section>
        <h3 className="mb-1 text-sm font-semibold">운송장 등록</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          추적번호를 등록하면 FO에 shipment 레코드가 연결됩니다. 출고 완료 전에 등록을 권장합니다.
        </p>
        {!canAssign && (
          <p className="mb-2 text-xs text-muted-foreground">
            현재 FO 상태({fo.status})에서는 운송장 등록이 허용되지 않습니다.
          </p>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">운송장 번호 (필수)</Label>
            <Input
              value={trackingNo}
              onChange={(e) => setTrackingNo(e.target.value)}
              placeholder="예: 1234567890"
              className="w-48"
              disabled={!canAssign}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">예상 도착일 (선택)</Label>
            <Input
              type="date"
              value={eta}
              onChange={(e) => setEta(e.target.value)}
              className="w-40"
              disabled={!canAssign}
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleAssignShipment}
            disabled={!canAssign || assignShipment.isPending || !trackingNo.trim()}
          >
            {assignShipment.isPending ? '등록 중...' : '운송장 등록'}
          </Button>
        </div>
      </section>

      {/* 출고 완료 (ship) */}
      <section className="rounded-md border p-4">
        <div className="mb-2 flex items-center gap-2">
          <Truck className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">출고 완료 처리</h3>
          <Badge variant="outline" className="text-xs">ship</Badge>
        </div>
        <p className="mb-2 text-xs text-muted-foreground">
          창고에서 상품이 물리적으로 출고되었을 때 실행합니다.
          FO 상태가 <span className="font-mono font-medium">shipped</span>로 전환되고
          <span className="font-mono"> FulfillmentShipped</span> 이벤트가 발행됩니다.
        </p>
        <Alert className="mb-3">
          <AlertTriangle />
          <AlertDescription>
            출고 완료 전 송장번호 또는 운송장 추적번호가 등록되어 있는지 확인하세요.
            ship 액션은 FO 상태가 invoiced / labeled / picked / inspecting일 때만 활성화됩니다.
          </AlertDescription>
        </Alert>
        {!canShip && (
          <p className="mb-2 text-xs text-muted-foreground">
            현재 FO 상태({fo.status})에서는 출고 완료 처리가 허용되지 않습니다.
            {fo.adminAvailableActions.length > 0 &&
              ` 가능한 액션: ${fo.adminAvailableActions.join(', ')}`}
          </p>
        )}
        <Button
          onClick={handleShip}
          disabled={!canShip || ship.isPending}
        >
          {ship.isPending ? '처리 중...' : '출고 완료 처리'}
        </Button>
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
