'use client';

import { ReactNode } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Can } from '@/components/auth/can';
import {
  FoConsolidationCell,
  FoStatusBadge,
} from '@/components/table/table-cells/fulfillment';
import { usePermissionCheck } from '@/hooks/use-permission';
import { siteLabel } from '@/lib/api/domains/sales-channel/vocabulary';
import { useFulfillmentOrder } from '@/lib/services/orders/queries';
import type {
  FulfillmentMode,
  FulfillmentOrderPriority,
} from '@/lib/types/dto/fulfillment';
import { InventoryTab } from '../../detail/inventory-tab';
import { ShipmentTab } from '../../detail/shipment-tab';
import { HistoryTab } from '../../detail/history-tab';
import { LineCompositions } from '../../detail/line-compositions';
import { useAssignLineComposition } from '@/lib/services/orders/line-composition';
import { foItemStatusLabel } from '../../../line-composition/line-composition-view';

// 종료 상태 — 라인 구성 편집을 막는다
const TERMINAL_STATUSES = new Set(['shipped', 'completed', 'canceled']);

const MODE_LABEL: Record<FulfillmentMode, string> = {
  in_house: '우리 창고',
  '3pl': '외부 물류(3PL)',
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

export function FulfillmentDetail({
  id,
  shipmentId,
}: {
  id: string;
  shipmentId?: string;
}) {
  const { can, canRun } = usePermissionCheck();
  const { data, isLoading } = useFulfillmentOrder(id);

  if (isLoading) {
    return (
      <div className="flex justify-center p-10">
        <Spinner />
      </div>
    );
  }

  if (!data) {
    return (
      <Container>
        <Header title="출고주문 상세" />
        <p className="p-6 text-sm text-muted-foreground">
          출고주문을 찾을 수 없습니다.
        </p>
      </Container>
    );
  }

  const isTerminal = TERMINAL_STATUSES.has(data.status);

  // 상자 링크로 들어왔으면 배송 탭에서 그 상자를 연다
  const opensShipment = !!shipmentId && can(['fulfillment.shipment.read']);
  const fo = {
    ...data,
    items: data.items ?? [],
    reservations: data.reservations ?? [],
    blockedReasons: data.blockedReasons ?? [],
  };

  return (
    <div className="flex w-full flex-col gap-y-3">
      {/* 헤더 + 액션 */}
      <Container className="divide-y">
        <div className="flex items-center justify-between p-3">
          <Header title="출고주문 상세" />
        </div>

        <InfoRow label="주문번호">
          {data.displayOrderNo ? (
            <span>
              #{data.displayOrderNo}
              {data.salesChannel && (
                <span className="ml-2 text-xs text-gray-500">
                  {siteLabel(data.salesChannel)}
                </span>
              )}
            </span>
          ) : (
            '-'
          )}
        </InfoRow>
        <InfoRow label="상태">
          <FoStatusBadge status={fo.status} consolidation={fo.consolidation} />
        </InfoRow>
        {(fo.consolidation != null || fo.shipments) && (
          <InfoRow label="상자">
            <div className="flex flex-wrap items-center gap-2">
              {fo.shipments && (
                <span>{`${fo.shipments.filter((box) => box.status !== 'superseded').length}개`}</span>
              )}
              {fo.consolidation != null && (
                <FoConsolidationCell value={fo.consolidation} />
              )}
            </div>
          </InfoRow>
        )}
        <InfoRow label="창고">{fo.warehouseName ?? '-'}</InfoRow>
        <InfoRow label="출고 방식">
          {fo.fulfillmentMode ? MODE_LABEL[fo.fulfillmentMode] : '-'}
        </InfoRow>
        <InfoRow label="우선순위">
          {PRIORITY_LABEL[fo.priority] ?? fo.priority}
        </InfoRow>
        <InfoRow label="이 주문 수량">
          {/* 출고가 끝나면 확보가 풀리는 게 정상이라 확보 수량은 진행 중일 때만 보인다 */}
          {isTerminal
            ? `${fo.totalItems}종 · ${fo.totalQty}개`
            : `${fo.totalItems}종 · ${fo.totalQty}개 · 재고 확보 ${fo.totalReservedQty}개`}
        </InfoRow>
        <InfoRow label="생성일">
          {new Date(fo.createdAt).toLocaleString('ko-KR')}
        </InfoRow>
        {fo.progress && (
          <InfoRow label="진행">
            {`출고 ${fo.progress.shippedQty} · 취소 ${fo.progress.canceledQty} · 남음 ${fo.progress.outstandingQty}`}
          </InfoRow>
        )}
        {fo.reservationFailureReason && (
          <InfoRow label="재고 확보 실패">
            <span className="text-red-600">{fo.reservationFailureReason}</span>
          </InfoRow>
        )}
      </Container>

      <LineCompositions fo={fo} canEdit={canRun(useAssignLineComposition) && !isTerminal} />

      <Container>
        <Header title={`보낼 상품 (${fo.items.length})`} />
        <div className="overflow-x-auto p-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-gray-500">
                <th className="py-2 pr-3">상품</th>
                <th className="py-2 pr-3">필요</th>
                <th className="py-2 pr-3">재고 확보</th>
                <th className="py-2 pr-3">피킹</th>
                <th className="py-2 pr-3">출고</th>
                <th className="py-2 pr-3">상태</th>
              </tr>
            </thead>
            <tbody>
              {fo.items.map((item) => (
                <tr key={item.id} className="border-b last:border-0">
                  <td className="py-2 pr-3">
                    <div className="flex flex-col">
                      <span className="font-medium">{item.skuName}</span>
                      <span className="font-mono text-xs text-gray-500">
                        {item.skuCode}
                      </span>
                    </div>
                  </td>
                  <td className="py-2 pr-3">{item.qty}</td>
                  <td className="py-2 pr-3">{item.reservedQty}</td>
                  <td className="py-2 pr-3">{item.pickedQty}</td>
                  <td className="py-2 pr-3">{item.shippedQty}</td>
                  <td className="py-2 pr-3">
                    <span className="text-xs text-gray-600">
                      {foItemStatusLabel(item)}
                    </span>
                  </td>
                </tr>
              ))}
              {fo.items.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="py-6 text-center text-muted-foreground"
                  >
                    보낼 상품이 없어요.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Container>

      <Container>
        <Header title="작업" />
        <div className="p-3">
          <Tabs
            defaultValue={opensShipment ? 'shipment' : 'inventory'}
            className="w-full"
          >
            <TabsList className="flex h-auto flex-wrap justify-start">
              <TabsTrigger value="inventory">재고</TabsTrigger>
              <Can anyOf={['fulfillment.shipment.read']}>
                <TabsTrigger value="shipment">배송</TabsTrigger>
              </Can>
              <TabsTrigger value="history">이력</TabsTrigger>
            </TabsList>
            <TabsContent value="inventory">
              <InventoryTab fo={fo} />
            </TabsContent>
            <Can anyOf={['fulfillment.shipment.read']}>
              <TabsContent value="shipment">
                <ShipmentTab fo={fo} initialShipmentId={shipmentId} />
              </TabsContent>
            </Can>
            <TabsContent value="history">
              <HistoryTab fo={fo} />
            </TabsContent>
          </Tabs>
        </div>
      </Container>
    </div>
  );
}
