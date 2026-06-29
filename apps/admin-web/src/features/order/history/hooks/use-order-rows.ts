// src/features/order/history/hooks/use-order-rows.ts
 
import { useMemo } from 'react';
import { customerApi, orders } from '@/lib/api/domains';
import { useVariantsBatch } from '@/lib/services/products';
import { useCreateOutboundBatch } from '@/lib/services/orders';
import type { SalesOrdersQuery } from '@/lib/types/dto/orders';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
export { filterRefundIssueRows } from './refund-filter.utils';

/** 테이블에서 1행 = 주문 라인 1개 */
export type OrderLineRow = {
  rowId: string; // `${orderId}-${lineId}`
  rowSeq: number; // 화면 표시 순번 (1부터)
  orderId: string;
  lineId: string;
  lineIndex: number; // 해당 주문 내 라인 순서 (1부터)
  orderLineCount: number; // 해당 주문의 전체 라인 수 (rowspan 계산용)
  isFirstOfOrder: boolean; // 동일 주문의 첫 번째 라인 여부 (셀 병합 기준)

  // 주문 헤더
  orderNo: string;
  orderDate: string;
  channel: string;
  phone?: string;
  customerName?: string; // 주문자
  receiverName?: string; // 수령자
  address?: string;
  personalCustomsCode?: string; // 해외직구 개인통관고유부호 (해외직구 주문만)
  totalAmount?: number;
  shippingFee?: number;
  orderStatus: string;
  memo?: string;
  workLogs?: { at: string; by: string; label: string }[];

  // 라인
  variantId: string;
  productName: string;
  optionName?: string;
  quantity: number;
  unitPrice?: number;
  totalPrice?: number;
  imageUrl?: string;
  skuId?: string;

  // 매칭/재고 상태
  isMatched: boolean;
  lineStatus: string; // pending / matched / stock_deducted / stock_unavailable / cancelled
  isReadyToShip: boolean;
  isUnavailable: boolean;
  isDirect: boolean;

  // 주문 완전출고 여부 (행 선택 기준)
  isOrderFullyAllocated: boolean;

  // 취소 주문 환불 상태
  refundStatus?: string;

  // 수동완료 대상 business link ID (부분취소가 여러 건인 경우 가장 최근 manual_pending 링크)
  refundLinkId?: string;

  // 부분취소 비례 배분 추정 환불액 (manual_pending 시 운영자 참고용, 실제 환불액이 아님)
  refundEstimateAmount?: number;

  // 부분취소 수동 검토 사유 코드 (운영자 UI 표시용)
  manualReason?: string;

  // Wallet 결제 인텐트 ID (결제 상세 이동용, cancelled 주문에서 사용)
  walletIntentId?: string | null;

  // 전체 주문 라인들 (모달에서 사용)
  lines: Array<{
    id: string;
    variantId: string;
    productName: string;
    optionName?: string;
    quantity: number;
    unitPrice?: number;
    totalPrice?: number;
    skuId?: string;
    status: string;
  }>;
};

export function useSalesOrderRows(query: SalesOrdersQuery & { _t?: number }) {
  // 1) 목록
  const listQuery = useQuery({
    queryKey: ['sales-orders', 'list-view', query],
    queryFn: () => orders.salesOrders.getSalesOrders(query),
    staleTime: 30 * 1000,
  });

  // 2) 상세 병렬 (최대 50건)
  const orderIds =
    listQuery.data?.data.map((i: any) => i.id).slice(0, 50) ?? [];
  const detailQueries = useQuery({
    queryKey: ['sales-orders', 'details', orderIds],
    enabled: orderIds.length > 0,
    staleTime: 30 * 1000,
    queryFn: async () => {
      if (!orderIds.length) return [];
      const details = await Promise.all(
        orderIds.map((id: string) =>
          orders.salesOrders.getSalesOrder(id).catch(() => null)
        )
      );
      return details;
    },
  });

  // 3) Variant 맵 (옵션 표시용)
  // 주문 라인에는 옵션 정보가 없고 PIM Variant 에만 있으므로 variantId 로 batch 조회한다.
  const allVariantIds = new Set<string>();
  detailQueries.data?.forEach((detail) => {
    detail?.lines?.forEach((item: any) => {
      if (item?.variantId) allVariantIds.add(item.variantId);
    });
  });
  const variantMapQuery = useVariantsBatch(Array.from(allVariantIds));

  // 4) 사용자 맵
  const allCustomerIds = new Set<string>();
  listQuery.data?.data?.forEach((li: any) => {
    if (li?.customerId) allCustomerIds.add(li.customerId);
  });
  detailQueries.data?.forEach((d: any) => {
    if (d?.customerId) allCustomerIds.add(d.customerId);
  });
  const userIds = Array.from(allCustomerIds);

  const userMapQuery = useQuery({
    queryKey: ['users', 'basic-map', [...userIds].sort().join(',')],
    enabled: userIds.length > 0,
    staleTime: 60 * 1000,
    queryFn: async () => {
      if (!userIds.length)
        return {} as Record<string, { username?: string; phone?: string }>;
      const results = await Promise.all(
        userIds.map(async (uid) => {
          try {
            const user = await customerApi.getCustomerById(uid);
            return [
              uid,
              {
                username: user.username ?? uid,
                phone: user.profile?.phoneNumber ?? undefined,
              },
            ] as const;
          } catch {
            return [uid, { username: uid }] as const;
          }
        })
      );
      const map: Record<string, { username?: string; phone?: string }> = {};
      results.forEach(([id, info]) => (map[id] = info));
      return map;
    },
  });

  // 5) 변환 → flat per-line rows
  const transformedData = useMemo((): {
    items: OrderLineRow[];
    total: number;
  } => {
    if (!listQuery.data) return { items: [], total: 0 };

    const detailMap = new Map<string, any>();
    detailQueries.data?.forEach((d: any) => {
      if (d?.id) detailMap.set(d.id, d);
    });

    // useVariantsBatch 의 select 가 Map<variantId, BatchVariantInfo> 로 반환한다.
    const variantMap = variantMapQuery.data ?? new Map();
    const userMap = userMapQuery.data ?? {};

    const lineRows: OrderLineRow[] = [];

    listQuery.data.data.forEach((listItem: any) => {
      const detail = detailMap.get(listItem.id);
      const customerId = detail?.customerId ?? listItem.customerId;
      const userInfo = customerId ? userMap[customerId] : undefined;

      // 주문자 정보 (고객)
      const customerName =
        detail?.customerName ?? userInfo?.username ?? customerId ?? '';

      // 수령자 정보 (shippingAddress에서 추출)
      const shippingAddress = detail?.shippingAddress;
      const receiverName = shippingAddress?.recipientName ?? customerName;
      const phone =
        shippingAddress?.phone ?? detail?.customerPhone ?? userInfo?.phone;

      const address = (() => {
        const sa = detail?.shippingAddress;
        if (!sa) return undefined;
        if (typeof sa === 'string') return sa;
        return `${sa.roadAddress ?? ''} ${sa.detailAddress ?? ''}`.trim();
      })();

      // 해외직구 주문만 채워짐 (shippingAddress JSON 안에 저장)
      const personalCustomsCode =
        shippingAddress && typeof shippingAddress === 'object'
          ? (shippingAddress.personalCustomsCode ??
            shippingAddress.customsCode ??
            undefined)
          : undefined;

      const lines: any[] = detail?.lines ?? [];

      // 주문의 모든 라인이 stock_deducted인지 확인
      const isOrderFullyAllocated =
        lines.length > 0 &&
        lines.every((l: any) => l.status === 'stock_deducted');

      const orderLineCount = lines.length || 1;

      lines.forEach((line: any, idx: number) => {
        const variant = line.variantId
          ? variantMap.get(line.variantId)
          : undefined;
        const optionName = variant?.optionLabel ?? line.optionName;

        const lineStatus: string = line.status ?? 'pending';
        const isMatched = !!line.productMatchingId;
        const isReadyToShip = lineStatus === 'stock_deducted';
        const isUnavailable = lineStatus === 'stock_unavailable';

        // 환불 상태 추출 (첫 번째 라인에서만 계산, 나머지는 공유)
        // cancelled 외에도 부분취소(partial)로 manual_pending이 생길 수 있으므로 상태 무관하게 조회
        const { refundStatus, refundLinkId, refundEstimateAmount, manualReason } =
          idx === 0
            ? (() => {
                const timeline: any[] = detail?.businessTimeline ?? [];
                const refundLinks = timeline
                  .filter(
                    (t: any) =>
                      t.relationName === 'cancellation_linked_wallet_refund'
                  )
                  .sort(
                    (a: any, b: any) =>
                      new Date(b.createdAt).getTime() -
                      new Date(a.createdAt).getTime()
                  );
                // Collect manual_pending links that have been completed via adminManualRefundComplete.
                // Completion creates a new succeeded link with completedRefundLinkId pointing to the
                // original manual_pending link — those should no longer surface as pending.
                const completedLinkIds = new Set<string>(
                  refundLinks
                    .filter(
                      (t: any) =>
                        t.metadata?.refundStatus === 'succeeded' &&
                        t.metadata?.completedRefundLinkId
                    )
                    .map((t: any) => t.metadata.completedRefundLinkId as string)
                );
                const pendingLink = refundLinks.find(
                  (t: any) =>
                    t.metadata?.refundStatus === 'manual_pending' &&
                    !completedLinkIds.has(t.id)
                );
                const effectiveLink = pendingLink ?? refundLinks[0];
                // refundEstimateAmount / manualReason은 부분취소 manual_pending 링크에만 존재
                const estimate = pendingLink?.metadata?.refundEstimateAmount;
                return {
                  refundStatus: effectiveLink?.metadata?.refundStatus as
                    | string
                    | undefined,
                  refundLinkId: pendingLink?.id as string | undefined,
                  refundEstimateAmount: typeof estimate === 'number' ? estimate : undefined,
                  manualReason: pendingLink?.metadata?.manualReason as string | undefined,
                };
              })()
            : { refundStatus: undefined, refundLinkId: undefined, refundEstimateAmount: undefined, manualReason: undefined };

        const walletIntentId: string | null | undefined =
          idx === 0
            ? (detail?.walletIntentId ?? listItem.walletIntentId ?? null)
            : undefined;

        const row: OrderLineRow = {
          rowId: `${listItem.id}-${line.id ?? idx}`,
          rowSeq: 0, // 아래에서 재계산
          orderId: listItem.id,
          lineId: line.id ?? `${listItem.id}-line-${idx}`,
          lineIndex: idx + 1,
          orderLineCount,
          isFirstOfOrder: idx === 0,

          orderNo: listItem.channelOrderId ?? String(listItem.id),
          orderDate: listItem.orderDate ?? listItem.createdAt,
          channel: listItem.salesChannel ?? detail?.salesChannel ?? 'medusa',
          phone,
          customerName,
          receiverName,
          address,
          personalCustomsCode,
          totalAmount: detail?.totalAmount ?? listItem.totalAmount,
          shippingFee: detail?.shippingFee ?? 0,
          orderStatus: listItem.status,
          memo: detail?.memo,
          workLogs: detail?.workLogs ?? [],

          variantId: line.variantId,
          productName: line.productName ?? variant?.masterName ?? line.variantId,
          optionName: optionName ?? undefined,
          quantity: Number(line.quantity ?? 1),
          unitPrice: line.unitPrice ?? undefined,
          totalPrice: line.totalPrice ?? undefined,
          imageUrl: line.imageUrl,
          skuId: line.skuId,

          isMatched,
          lineStatus,
          isReadyToShip,
          isUnavailable,
          isDirect: !!line.isDirect,

          isOrderFullyAllocated,

          refundStatus,
          refundLinkId,
          refundEstimateAmount,
          manualReason,
          walletIntentId,

          // 전체 주문 라인들 추가
          lines: lines.map((l: any) => ({
            id: l.id,
            variantId: l.variantId,
            productName:
              l.productName ?? variantMap.get(l.variantId)?.masterName,
            optionName:
              variantMap.get(l.variantId)?.optionLabel ?? l.optionName,
            quantity: Number(l.quantity ?? 1),
            unitPrice: l.unitPrice,
            totalPrice: l.totalPrice,
            skuId: l.skuId,
            status: l.status ?? 'pending',
          })),
        };
        lineRows.push(row);
      });

      // 라인이 없는 주문도 1행으로 표시
      if (lines.length === 0) {
        lineRows.push({
          rowId: `${listItem.id}-empty`,
          rowSeq: 0,
          orderId: listItem.id,
          lineId: `${listItem.id}-empty`,
          lineIndex: 1,
          orderLineCount: 1,
          isFirstOfOrder: true,
          orderNo: listItem.channelOrderId ?? String(listItem.id),
          orderDate: listItem.orderDate ?? listItem.createdAt,
          channel: listItem.salesChannel ?? 'medusa',
          phone,
          customerName,
          receiverName,
          address,
          totalAmount: listItem.totalAmount,
          shippingFee: 0,
          orderStatus: listItem.status,
          memo: undefined,
          workLogs: [],
          variantId: '',
          productName: '(상품 정보 없음)',
          quantity: 0,
          isMatched: false,
          lineStatus: 'pending',
          isReadyToShip: false,
          isUnavailable: false,
          isDirect: false,
          isOrderFullyAllocated: false,
          lines: [], // 빈 배열
        });
      }
    });

    // rowSeq: 최신순(내림차순) → top row = 전체 건수, bottom = 1
    const total = lineRows.length;
    lineRows.forEach((r, idx) => {
      r.rowSeq = total - idx;
    });

    return { items: lineRows, total };
  }, [listQuery.data, detailQueries.data, variantMapQuery.data, userMapQuery.data]);

  return {
    data: transformedData,
    isLoading:
      listQuery.isLoading ||
      detailQueries.isLoading ||
      variantMapQuery.isLoading ||
      userMapQuery.isLoading,
    isFetching:
      listQuery.isFetching ||
      detailQueries.isFetching ||
      variantMapQuery.isFetching ||
      userMapQuery.isFetching,
    error:
      listQuery.error ||
      detailQueries.error ||
      variantMapQuery.error ||
      userMapQuery.error,
    refetch: () => {
      listQuery.refetch();
      detailQueries.refetch();
      variantMapQuery.refetch();
      userMapQuery.refetch();
    },
  };
}

/** 선택된 주문 ID로 출고 배치를 생성하고 FO를 연결한다. */
export function useCreatePickingLists() {
  const queryClient = useQueryClient();
  const createBatch = useCreateOutboundBatch();

  return useMutation({
    mutationFn: async (orderIds: string[]) => {
      if (orderIds.length === 0) return [];
      const batches = [];
      const BATCH_SIZE = 20;

      for (let i = 0; i < orderIds.length; i += BATCH_SIZE) {
        const batchOrderIds = orderIds.slice(i, i + BATCH_SIZE);
        const batch = await createBatch.mutateAsync({
          pickingMethod: 'individual',
          name: `피킹리스트-${new Date().toISOString().slice(0, 10)}-${Math.floor(i / BATCH_SIZE) + 1}`,
          salesOrderIds: batchOrderIds,
        });
        batches.push(batch);
      }

      return batches;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['outbound-batches'] });
    },
  });
}

// 하위 호환 - 모달 컴포넌트가 참조하는 타입 (as any 캐스팅으로 전달되므로 느슨하게 유지)
 
export type SalesOrderRow = any;
