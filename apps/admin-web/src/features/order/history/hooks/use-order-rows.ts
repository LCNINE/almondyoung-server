// src/features/order/history/hooks/use-order-rows.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { customerApi, orders } from '@/lib/api/domains';
import { useSkusByIds } from '@/lib/services/inventory';
import { useCreateOutboundBatch } from '@/lib/services/orders';
import type { SalesOrdersQuery } from '@/lib/types/dto/orders';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

// UI 타입
export type OrderLine = {
  id: string;
  productName: string;
  optionName?: string;
  quantity: number;
  imageUrl?: string;
  isMatched?: boolean;
  isReadyToShip?: boolean;
  isDirect?: boolean;
  skuId?: string;
  variantId?: string;
};

export type SalesOrderRow = {
  id: string;
  orderNo: string;
  orderDate: string;
  customerName: string;
  receiverName: string;
  phone?: string;
  address?: string;
  channel?: string;
  sellerName?: string;
  status: 'pending' | 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'timeout' | string;
  lines: OrderLine[];
  memo?: string;
  workLogs?: { at: string; by: string; label: string }[];
  directShipInvoiceNo?: string;
  fulfillmentOrderId?: string;
  isFullyAllocated?: boolean;
};

/**
 * 주문 목록 + 상세 + SKU + 사용자(username/phone)까지 조합한 UI 모델
 */
export function useSalesOrderRows(query: SalesOrdersQuery) {
  // 1) 목록
  const listQuery = useQuery({
    queryKey: ['sales-orders', 'list-view', query],
    queryFn: () => orders.salesOrders.getSalesOrders(query),
    staleTime: 30 * 1000,
  });

  // 2) 상세 병렬 (최대 20건)
  const orderIds =
    listQuery.data?.data.map((i: any) => i.id).slice(0, 20) ?? [];
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

  // 3) SKU 맵
  const allSkuIds = new Set<string>();
  detailQueries.data?.forEach((detail) => {
    detail?.lines?.forEach((item: any) => {
      if (item?.skuId) allSkuIds.add(item.skuId);
    });
  });
  const skuIds = Array.from(allSkuIds);
  const skuMapQuery = useSkusByIds(skuIds);

  // 3.5) 사용자 맵 (username/phone)
  const allCustomerIds = new Set<string>();
  listQuery.data?.data?.forEach((li: any) => {
    if (li?.customerId) allCustomerIds.add(li.customerId);
  });
  detailQueries.data?.forEach((d: any) => {
    if (d?.customerId) allCustomerIds.add(d.customerId);
  });
  const userIds = Array.from(allCustomerIds);

  const userMapQuery = useQuery({
    queryKey: ['users', 'basic-map', userIds.sort().join(',')],
    enabled: userIds.length > 0,
    staleTime: 60 * 1000,
    queryFn: async () => {
      if (!userIds.length)
        return {} as Record<string, { username?: string; phone?: string }>;
      const results = await Promise.all(
        userIds.map(async (uid) => {
          try {
            // username은 getUser, phone은 getUserDetails(profile)에서 확보
            const user = await customerApi.getCustomerById(uid);

            return [
              uid,
              {
                username: user.data.username ?? uid,
                phone: user.data.phoneNumber,
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

  // 4) 변환
  const transformedData = () => {
    if (!listQuery.data) return { items: [], total: 0 };

    // 상세를 id→detail 맵으로(인덱스 의존 제거)
    const detailMap = new Map<string, any>();
    detailQueries.data?.forEach((d: any) => {
      if (d?.id) detailMap.set(d.id, d);
    });

    const skuMap =
      skuMapQuery.data &&
      typeof skuMapQuery.data === 'object' &&
      !Array.isArray(skuMapQuery.data)
        ? (skuMapQuery.data as Record<string, any>)
        : ({} as Record<string, any>);
    const userMap = userMapQuery.data ?? {};

    const items = listQuery.data.data.map((listItem: any) => {
      const detail = detailMap.get(listItem.id);
      const detailExt = detail;

      const customerId = detail?.customerId ?? listItem.customerId;
      const userInfo = customerId ? userMap[customerId] : undefined;

      const row: SalesOrderRow = {
        id: listItem.id,
        orderNo: String(listItem.id).replace('SO', 'ORD'),
        orderDate: listItem.createdAt,
        customerName: userInfo?.username ?? customerId ?? '',
        receiverName:
          detailExt?.customerName ?? userInfo?.username ?? customerId ?? '',
        phone: detailExt?.customerPhone ?? userInfo?.phone,
        address: (() => {
          const sa = detailExt?.shippingAddress;
          if (!sa) return undefined;
          if (typeof sa === 'string') return sa;
          return `${sa.roadAddress ?? ''} ${sa.detailAddress ?? ''}`.trim();
        })(),
        channel: detailExt?.channel ?? listItem.channel ?? 'own',
        sellerName: detailExt?.sellerName ?? listItem.sellerName,
        status: listItem.status,
        memo: detail?.memo,
        workLogs: detailExt?.workLogs ?? [],
        directShipInvoiceNo: detailExt?.directShipInvoiceNo,
        fulfillmentOrderId: detailExt?.fulfillmentOrderId,
        lines: [],
      };

      if (detail?.lines) {
        row.lines = detail.lines.map((item: any, idx: number) => {
          const sku = item.skuId ? skuMap[item.skuId] : undefined;
          const skuExt = sku;

          const optionName = sku?.optionKey
            ? Object.entries(sku.optionKey)
                .map(([, value]) => `${value}`)
                .join(', ')
            : (skuExt?.optionName ?? item.optionName);

          const allocated = Number(item?.allocatedQuantity ?? 0);
          const quantity = Number(item?.quantity ?? 0);

          const line: OrderLine = {
            id: `${row.id}-L${idx + 1}`,
            skuId: item.skuId,
            variantId: item.variantId,
            productName: sku?.name ?? item.productName ?? item.variantId,
            optionName: optionName ?? '단일상품',
            quantity,
            imageUrl: skuExt?.imageUrl ?? item.imageUrl,
            isMatched: !!item.productMatchingId,
            isReadyToShip: allocated >= quantity,
            isDirect: !!item.isDirect,
          };

          return line;
        });
      }

      row.isFullyAllocated =
        row.lines.length > 0 && row.lines.every((l) => l.isReadyToShip);

      return row;
    });

    return { ...listQuery.data, items };
  };

  return {
    data: transformedData(),
    isLoading:
      listQuery.isLoading ||
      detailQueries.isLoading ||
      skuMapQuery.isLoading ||
      userMapQuery.isLoading,
    isFetching:
      listQuery.isFetching ||
      detailQueries.isFetching ||
      skuMapQuery.isFetching ||
      userMapQuery.isFetching,
    error:
      listQuery.error ||
      detailQueries.error ||
      skuMapQuery.error ||
      userMapQuery.error,
    refetch: () => {
      listQuery.refetch();
      detailQueries.refetch();
      skuMapQuery.refetch();
      userMapQuery.refetch();
    },
  };
}

/**
 * 주문을 피킹리스트로 변환
 */
export function useCreatePickingLists() {
  const queryClient = useQueryClient();
  const createBatch = useCreateOutboundBatch();

  return useMutation({
    mutationFn: async (orderIds: string[]) => {
      const batches = [];
      const BATCH_SIZE = 20;

      for (let i = 0; i < orderIds.length; i += BATCH_SIZE) {
        const batchOrderIds = orderIds.slice(i, i + BATCH_SIZE);

        const batch = await createBatch.mutateAsync({
          warehouseId: 'WH001',
          pickingMethod: 'batch',
          name: `피킹리스트-${new Date().toISOString().slice(0, 10)}-${i + 1}`,
        });
        void batchOrderIds; // TODO: batch.id에 fulfillment orders 추가 로직 연결 필요

        batches.push(batch);
      }

      return batches;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      queryClient.invalidateQueries({ queryKey: ['outbound-batches'] });
    },
  });
}

