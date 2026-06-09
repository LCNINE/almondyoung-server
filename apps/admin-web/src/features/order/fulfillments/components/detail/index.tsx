'use client';

import { ReactNode } from 'react';
import { toast } from 'sonner';
import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { FoStatusBadge } from '@/components/table/table-cells/fulfillment';
import { useFulfillmentOrder } from '@/lib/services/orders/queries';
import {
  useShipFulfillment,
  useCancelFulfillment,
  useReserveFulfillmentItem,
} from '@/lib/services/orders/mutations';
import type { FulfillmentMode, FulfillmentOrderPriority } from '@/lib/types/dto/fulfillment';
import { InventoryTab } from '../../detail/inventory-tab';
import { SplitTab } from '../../detail/split-tab';
import { ShipmentTab } from '../../detail/shipment-tab';
import { DirectShipTab } from '../../detail/direct-ship-tab';
import { HistoryTab } from '../../detail/history-tab';

// 출고/취소가 불가능한 종료 상태
const TERMINAL_STATUSES = new Set(['shipped', 'completed', 'canceled']);

const MODE_LABEL: Record<FulfillmentMode, string> = {
  in_house: '자가출고',
  '3pl': '3PL',
  drop_ship: '직배송',
};

const PRIORITY_LABEL: Record<FulfillmentOrderPriority, string> = {
  normal: '보통',
  high: '높음',
  urgent: '긴급',
};

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 p-3">
      <div className="text-sm font-medium text-gray-500">{label}</div>
      <div className="col-span-2 text-sm">{children}</div>
    </div>
  );
}

function ConfirmActionButton({
  label,
  title,
  description,
  onConfirm,
  disabled,
  variant = 'default',
}: {
  label: string;
  title: string;
  description: string;
  onConfirm: () => void;
  disabled?: boolean;
  variant?: 'default' | 'destructive' | 'outline';
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant={variant} disabled={disabled} size="sm">
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>확인</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function FulfillmentDetail({ id }: { id: string }) {
  const { data, isLoading } = useFulfillmentOrder(id);
  const shipMutation = useShipFulfillment();
  const cancelMutation = useCancelFulfillment();
  const reserveMutation = useReserveFulfillmentItem();

  if (isLoading) {
    return (
      <div className="flex justify-center p-10">
        <Spinner />
      </div>
    );
  }

  if (!data) {
    return (
      <Container className="divide-y-0">
        <Header title="출고주문 상세" />
        <p className="p-6 text-sm text-muted-foreground">출고주문을 찾을 수 없습니다.</p>
      </Container>
    );
  }

  const isTerminal = TERMINAL_STATUSES.has(data.status);
  const fo = {
    ...data,
    items: data.items ?? [],
    reservations: data.reservations ?? [],
    adminAvailableActions: data.adminAvailableActions ?? [],
    blockedReasons: data.blockedReasons ?? [],
  };

  const handleShip = async () => {
    try {
      await shipMutation.mutateAsync(id);
      toast.success('출고 처리되었습니다.');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '출고 처리에 실패했습니다.');
    }
  };

  const handleCancel = async () => {
    try {
      await cancelMutation.mutateAsync(id);
      toast.success('출고주문이 취소되었습니다.');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '취소에 실패했습니다.');
    }
  };

  const handleReserve = async (foiId: string, remaining: number) => {
    try {
      await reserveMutation.mutateAsync({
        id,
        fulfillmentOrderItemId: foiId,
        quantity: remaining,
      });
      toast.success(`재고 ${remaining}개 예약 완료`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '예약에 실패했습니다.');
    }
  };

  return (
    <div className="flex w-full flex-col gap-y-3">
      {/* 헤더 + 액션 */}
      <Container className="divide-y">
        <div className="flex items-center justify-between p-3">
          <Header title="출고주문 상세" />
          <div className="flex gap-2">
            <ConfirmActionButton
              label="출고"
              title="출고 처리"
              description="이 출고주문을 출고 처리하시겠습니까? 모든 라인이 배송 상태로 전환됩니다."
              onConfirm={handleShip}
              disabled={isTerminal || shipMutation.isPending}
            />
            <ConfirmActionButton
              label="취소"
              title="출고주문 취소"
              description="이 출고주문을 취소하시겠습니까? 예약된 재고가 해제됩니다."
              onConfirm={handleCancel}
              disabled={isTerminal || cancelMutation.isPending}
              variant="destructive"
            />
          </div>
        </div>

        <InfoRow label="주문번호">
          <span className="font-mono text-xs">{data.id}</span>
        </InfoRow>
        <InfoRow label="상태">
          <FoStatusBadge status={fo.status} />
        </InfoRow>
        <InfoRow label="창고">
          <span className="font-mono text-xs">{fo.warehouseId ?? '-'}</span>
        </InfoRow>
        <InfoRow label="모드">
          {fo.fulfillmentMode ? MODE_LABEL[fo.fulfillmentMode] : '-'}
        </InfoRow>
        <InfoRow label="우선순위">{PRIORITY_LABEL[fo.priority] ?? fo.priority}</InfoRow>
        <InfoRow label="수량">
          아이템 {fo.totalItems} / 총 {fo.totalQty} / 예약 {fo.totalReservedQty}
        </InfoRow>
        {fo.salesOrderId && (
          <InfoRow label="원본 주문(SO)">
            <span className="font-mono text-xs">{fo.salesOrderId}</span>
          </InfoRow>
        )}
        <InfoRow label="생성일">
          {new Date(fo.createdAt).toLocaleString('ko-KR')}
        </InfoRow>
        {fo.invoice && (
          <InfoRow label="송장">
            {fo.invoice.invoiceNumber} ({fo.invoice.status})
            {fo.invoice.carrierCode ? ` · ${fo.invoice.carrierCode}` : ''}
          </InfoRow>
        )}
        {fo.reservationFailureReason && (
          <InfoRow label="예약 실패">
            <span className="text-red-600">{fo.reservationFailureReason}</span>
          </InfoRow>
        )}
      </Container>

      {/* FOI 라인 */}
      <Container className="divide-y-0">
        <Header title={`출고 라인 (${fo.items.length})`} />
        <div className="overflow-x-auto p-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-gray-500">
                <th className="py-2 pr-3">SKU</th>
                <th className="py-2 pr-3">요청</th>
                <th className="py-2 pr-3">예약</th>
                <th className="py-2 pr-3">피킹</th>
                <th className="py-2 pr-3">출고</th>
                <th className="py-2 pr-3">상태</th>
                <th className="py-2 pr-3" />
              </tr>
            </thead>
            <tbody>
              {fo.items.map((item) => {
                const remaining = item.qty - item.reservedQty;
                const canReserve = remaining > 0 && !isTerminal;
                return (
                  <tr key={item.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      <div className="flex flex-col">
                        <span className="font-medium">{item.skuName}</span>
                        <span className="font-mono text-xs text-gray-500">{item.skuCode}</span>
                      </div>
                    </td>
                    <td className="py-2 pr-3">{item.qty}</td>
                    <td className="py-2 pr-3">{item.reservedQty}</td>
                    <td className="py-2 pr-3">{item.pickedQty}</td>
                    <td className="py-2 pr-3">{item.shippedQty}</td>
                    <td className="py-2 pr-3">
                      <span className="text-xs text-gray-600">{item.status}</span>
                    </td>
                    <td className="py-2 pr-3 text-right">
                      {canReserve && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleReserve(item.id, remaining)}
                          disabled={reserveMutation.isPending}
                        >
                          예약 ({remaining})
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {fo.items.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-muted-foreground">
                    출고 라인이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Container>

      <Container className="divide-y-0">
        <Header title="운영 액션" />
        <div className="p-3">
          <Tabs defaultValue="inventory" className="w-full">
            <TabsList className="flex h-auto flex-wrap justify-start">
              <TabsTrigger value="inventory">재고</TabsTrigger>
              <TabsTrigger value="split">분할</TabsTrigger>
              <TabsTrigger value="shipment">배송</TabsTrigger>
              {fo.fulfillmentMode === 'drop_ship' && (
                <TabsTrigger value="direct-ship">직배</TabsTrigger>
              )}
              <TabsTrigger value="history">이력</TabsTrigger>
            </TabsList>
            <TabsContent value="inventory">
              <InventoryTab fo={fo} />
            </TabsContent>
            <TabsContent value="split">
              <SplitTab fo={fo} />
            </TabsContent>
            <TabsContent value="shipment">
              <ShipmentTab fo={fo} />
            </TabsContent>
            {fo.fulfillmentMode === 'drop_ship' && (
              <TabsContent value="direct-ship">
                <DirectShipTab fo={fo} />
              </TabsContent>
            )}
            <TabsContent value="history">
              <HistoryTab fo={fo} />
            </TabsContent>
          </Tabs>
        </div>
      </Container>
    </div>
  );
}
