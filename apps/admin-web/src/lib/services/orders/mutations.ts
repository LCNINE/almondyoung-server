// src/lib/services/orders/mutations.ts
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { orderQueryKeys } from './query-keys';
import { orders } from '@/lib/api/domains';
import { isConflict } from '@/lib/api/domains/orders/sales-order-amendments.shape';
import type {
  CancelSalesOrderDto,
  ResolveMatchingDto,
  SetMatchingPriorityDto,
  ChangeStrategyDto,
  StockPolicyDto,
  VariantMatchingDto,
} from '@/lib/types/dto/orders';
import type {
  ForwardDirectShipOrdersRequest,
  CompleteDirectShipOrdersRequest,
  SplitShipmentRequest,
  SplitUnreservedShipmentRequest,
  ReviseShipmentRecipientRequest,
  PlanShipmentRequest,
  RecallShipmentRequest,
  ReportShipmentShortPickRequest,
  CreateShipmentConsolidationRequest,
  ShipmentInspectionScanRequest,
  ForceShipmentDispatchRequest,
  CreateOutboundBatchV2Request,
  ClaimBatchWorkItemRequest,
  HandoffBatchWorkItemRequest,
  StartPickingV2Request,
  DiscretePickingScanRequest,
  PickingHandoffRequest,
  CompletePickingRequest,
  AggregateBulkCartScanRequest,
  AggregateSortScanRequest,
  AggregateCartHandoffRequest,
  RegisterToteRequest,
  AssignToteRequest,
  ToteScanRequest,
  ToteHandoffRequest,
  ReleaseToteRequest,
  IssueWaybillRequest,
  RegisterManualWaybillRequest,
  IssueBatchWaybillRequest,
  VoidWaybillRequest,
} from '@/lib/types/dto/fulfillment';
import type { PermissionRequirement } from '@/lib/auth/mutation-permission';

function commandKey(idempotencyKey?: string): string {
  return idempotencyKey ?? crypto.randomUUID();
}

// 주문 관련 뮤테이션
export const useCreateSalesOrder = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: orders.salesOrders.createSalesOrder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.orders });
    },
  });
};
useCreateSalesOrder.permission = ['order.order.write'] as const satisfies PermissionRequirement;

export const useUpdateSalesOrder = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      orders.salesOrders.updateSalesOrder(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.orders });
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.order(id) });
    },
  });
};
useUpdateSalesOrder.permission = ['order.order.write'] as const satisfies PermissionRequirement;

export const useCancelSalesOrder = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body?: CancelSalesOrderDto }) =>
      orders.salesOrders.cancelSalesOrder(id, body),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.orders });
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.order(id) });
    },
  });
};
useCancelSalesOrder.permission = ['order.order.cancel'] as const satisfies PermissionRequirement;

export const useAdminCancelSalesOrder = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body?: CancelSalesOrderDto }) =>
      orders.salesOrders.adminCancelSalesOrder(id, body),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.orders });
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.order(id) });
    },
  });
};
useAdminCancelSalesOrder.permission = ['order.order.cancel'] as const satisfies PermissionRequirement;

export const useAdminRetryRefund = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => orders.salesOrders.adminRetryRefund(id),
    onSuccess: (_, id) => {
      // ['sales-orders'] prefix covers useSalesOrderRows(['sales-orders', 'list-view', ...])
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.orders });
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.order(id) });
    },
  });
};
useAdminRetryRefund.permission = ['payment.refund.execute'] as const satisfies PermissionRequirement;

export const useAdminManualRefundComplete = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      adminNote,
      refundLinkId,
    }: {
      id: string;
      adminNote?: string;
      refundLinkId?: string;
    }) =>
      orders.salesOrders.adminManualRefundComplete(id, adminNote, refundLinkId),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.orders });
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.order(id) });
    },
  });
};
useAdminManualRefundComplete.permission = ['payment.refund.execute'] as const satisfies PermissionRequirement;

// ===== 매칭 관련 뮤테이션 (WMS API 스펙 기반) =====

/**
 * 전략 미결정 해소 (SKU 구성 매칭 또는 재고상품 비매칭)
 */
export const useResolveMatching = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ResolveMatchingDto }) =>
      orders.matching.resolveMatching(id, data),
    onSuccess: (data, variables) => {
      // 매칭 목록 쿼리 무효화
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.matchingLists(),
      });

      // 개별 매칭 쿼리 무효화
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.matchingDetail(variables.id),
      });

      // Variant별 매칭 쿼리 무효화
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.variantMatchings(),
      });

      // 주문 라인 매칭 현황 전체 무효화
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.matchings,
      });
    },
  });
};
useResolveMatching.permission = ['order.matching.write'] as const satisfies PermissionRequirement;

/**
 * 전략 미결정 우선순위 설정
 */
export const useSetMatchingPriority = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: SetMatchingPriorityDto }) =>
      orders.matching.setMatchingPriority(id, data),
    onSuccess: (data, variables) => {
      // 매칭 목록 쿼리 무효화
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.matchingLists(),
      });

      // 개별 매칭 쿼리 무효화
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.matchingDetail(variables.id),
      });
    },
  });
};
useSetMatchingPriority.permission = ['order.matching.write'] as const satisfies PermissionRequirement;

/**
 * 매칭 전략 변경
 */
export const useChangeMatchingStrategy = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ChangeStrategyDto }) =>
      orders.matching.changeMatchingStrategy(id, data),
    onSuccess: (data, variables) => {
      // 매칭 목록 쿼리 무효화
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.matchingLists(),
      });

      // 개별 매칭 쿼리 무효화
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.matchingDetail(variables.id),
      });
    },
  });
};
useChangeMatchingStrategy.permission = ['order.matching.write'] as const satisfies PermissionRequirement;

/**
 * 매칭의 재고 정책 업데이트
 */
export const useUpdateMatchingStockPolicy = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: StockPolicyDto }) =>
      orders.matching.updateMatchingStockPolicy(id, data),
    onSuccess: (data, variables) => {
      // 매칭 목록 쿼리 무효화
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.matchingLists(),
      });

      // 개별 매칭 쿼리 무효화
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.matchingDetail(variables.id),
      });

      // 재고 정책 쿼리 무효화
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.stockPolicies(),
      });
    },
  });
};
useUpdateMatchingStockPolicy.permission = ['order.matching.write'] as const satisfies PermissionRequirement;

/**
 * Variant별 매칭 업데이트
 */
export const useUpdateVariantMatching = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      variantId,
      data,
    }: {
      variantId: string;
      data: Partial<VariantMatchingDto>;
    }) => orders.matching.updateVariantMatching(variantId, data),
    onSuccess: (data, variables) => {
      // Variant별 매칭 쿼리 무효화
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.variantMatching(variables.variantId),
      });

      // 매칭 목록 쿼리 무효화
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.matchingLists(),
      });
    },
  });
};
useUpdateVariantMatching.permission = ['order.matching.write'] as const satisfies PermissionRequirement;

/**
 * 재고상품 비매칭 처리 (하위 호환 편의 함수)
 */
export const useIgnoreMatching = () => {
  const resolveMatching = useResolveMatching();

  return useMutation({
    mutationFn: ({
      id,
      stockPolicy,
    }: {
      id: string;
      stockPolicy?: StockPolicyDto;
    }) =>
      resolveMatching.mutateAsync({
        id,
        data: {
          ignore: false,
          resolveAsVoid: true,
          strategy: 'void',
          stockPolicy: stockPolicy || {
            preStockSellable: true,
            alwaysSellableZeroStock: false,
          },
          isGift: false,
        },
      }),
  });
};
useIgnoreMatching.permission = ['order.matching.write'] as const satisfies PermissionRequirement;

/**
 * SKU 구성 매칭 처리 (편의 함수)
 */
export const useCompleteMatching = () => {
  const resolveMatching = useResolveMatching();

  return useMutation({
    mutationFn: ({
      id,
      skuIds,
      skuMappings,
      stockPolicy,
      isGift = false,
    }: {
      id: string;
      skuIds?: string[];
      skuMappings?: Array<{ skuId: string; quantity: number }>;
      stockPolicy?: StockPolicyDto;
      isGift?: boolean;
    }) =>
      resolveMatching.mutateAsync({
        id,
        data: {
          skuIds,
          skuMappings,
          ignore: false,
          strategy: 'variant',
          stockPolicy: stockPolicy || {
            preStockSellable: true,
            alwaysSellableZeroStock: false,
          },
          isGift,
        },
      }),
  });
};
useCompleteMatching.permission = ['order.matching.write'] as const satisfies PermissionRequirement;

// ===== 직배송 뮤테이션 (D2) =====

export const useForwardDirectShipOrders = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ForwardDirectShipOrdersRequest) =>
      orders.directShip.forwardOrders(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['direct-ship'] });
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.fulfillments });
    },
  });
};
useForwardDirectShipOrders.permission = ['fulfillment.order.write'] as const satisfies PermissionRequirement;

export const useCompleteDirectShipOrders = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CompleteDirectShipOrdersRequest) =>
      orders.directShip.completeOrders(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['direct-ship'] });
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.fulfillments });
    },
  });
};
useCompleteDirectShipOrders.permission = ['fulfillment.order.write'] as const satisfies PermissionRequirement;

export const useExportDirectShipFile = () => {
  return useMutation({
    mutationFn: (companyName: string) =>
      orders.directShip.exportFile(companyName),
  });
};
useExportDirectShipFile.permission = ['order.order.export'] as const satisfies PermissionRequirement;

// ===== FO 액션 뮤테이션 (Core /fulfillments canonical API) =====

function invalidateFulfillment(
  queryClient: ReturnType<typeof useQueryClient>,
  id: string
) {
  queryClient.invalidateQueries({ queryKey: orderQueryKeys.fulfillments });
  queryClient.invalidateQueries({ queryKey: orderQueryKeys.fulfillment(id) });
  queryClient.invalidateQueries({ queryKey: orderQueryKeys.outboundBatches });
  queryClient.invalidateQueries({ queryKey: ['inventory', 'reservations'] });
  queryClient.invalidateQueries({ queryKey: ['direct-ship'] });
}

// ===== Shipment planning / durable operations =====

function invalidateShipment(
  queryClient: ReturnType<typeof useQueryClient>,
  shipmentId: string
) {
  queryClient.invalidateQueries({
    queryKey: orderQueryKeys.shipment(shipmentId),
  });
  queryClient.invalidateQueries({ queryKey: orderQueryKeys.fulfillments });
  queryClient.invalidateQueries({ queryKey: orderQueryKeys.outboundBatches });
}

export const useSplitShipment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      shipmentId,
      data,
      idempotencyKey,
    }: {
      shipmentId: string;
      data: SplitShipmentRequest;
      idempotencyKey?: string;
    }) =>
      orders.fulfillmentOrder.splitShipment(
        shipmentId,
        data,
        commandKey(idempotencyKey)
      ),
    onSuccess: (_, { shipmentId }) =>
      invalidateShipment(queryClient, shipmentId),
  });
};
useSplitShipment.permission = ['fulfillment.warehouse.operate'] as const satisfies PermissionRequirement;

/**
 * 정체 보드 예약 줄의 «있는 것 먼저». 409(이미 다 예약됨·합포장·상자가 바뀜)는 행이 낡았다는 뜻이라
 * 성공이든 실패든 보드 목록·요약을 다시 읽는다 — 안 그러면 같은 행이 같은 버튼을 계속 보여준다.
 */
export const useSplitUnreservedShipment = () => {
  const queryClient = useQueryClient();
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['order-progress'] });
    queryClient.invalidateQueries({ queryKey: orderQueryKeys.fulfillments });
    // 메인·통계·주문내역의 «출고 불가» 카드가 같은 집합을 센다 — 나누면 숫자가 줄어야 한다
    queryClient.invalidateQueries({ queryKey: orderQueryKeys.orderStats });
  };
  return useMutation({
    mutationFn: ({
      shipmentId,
      data,
      idempotencyKey,
    }: {
      shipmentId: string;
      data: SplitUnreservedShipmentRequest;
      idempotencyKey?: string;
    }) =>
      orders.fulfillmentOrder.splitUnreservedShipment(
        shipmentId,
        data,
        commandKey(idempotencyKey)
      ),
    onSuccess: (_, { shipmentId }) => {
      refresh();
      invalidateShipment(queryClient, shipmentId);
    },
    onError: (error) => {
      if (isConflict(error)) refresh();
    },
  });
};
useSplitUnreservedShipment.permission = ['fulfillment.warehouse.operate'] as const satisfies PermissionRequirement;

export const useReviseShipmentRecipient = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      shipmentId,
      data,
      idempotencyKey,
    }: {
      shipmentId: string;
      data: ReviseShipmentRecipientRequest;
      idempotencyKey?: string;
    }) =>
      orders.fulfillmentOrder.reviseShipmentRecipient(
        shipmentId,
        data,
        commandKey(idempotencyKey)
      ),
    onSuccess: (_, { shipmentId }) =>
      invalidateShipment(queryClient, shipmentId),
  });
};
useReviseShipmentRecipient.permission = ['fulfillment.shipment.override_recipient'] as const satisfies PermissionRequirement;

export const usePlanShipment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      shipmentId,
      data,
      idempotencyKey,
    }: {
      shipmentId: string;
      data: PlanShipmentRequest;
      idempotencyKey?: string;
    }) =>
      orders.fulfillmentOrder.planShipment(
        shipmentId,
        data,
        commandKey(idempotencyKey)
      ),
    onSuccess: (_, { shipmentId }) =>
      invalidateShipment(queryClient, shipmentId),
  });
};
usePlanShipment.permission = ['fulfillment.warehouse.operate'] as const satisfies PermissionRequirement;

export const useRecallShipment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      shipmentId,
      data,
      idempotencyKey,
    }: {
      shipmentId: string;
      data: RecallShipmentRequest;
      idempotencyKey?: string;
    }) =>
      orders.fulfillmentOrder.recallShipment(
        shipmentId,
        data,
        commandKey(idempotencyKey)
      ),
    onSuccess: (_, { shipmentId }) =>
      invalidateShipment(queryClient, shipmentId),
  });
};
useRecallShipment.permission = ['fulfillment.dispatch.recall'] as const satisfies PermissionRequirement;

export const useReportShipmentShortPick = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      shipmentId,
      data,
      idempotencyKey,
    }: {
      shipmentId: string;
      data: ReportShipmentShortPickRequest;
      idempotencyKey?: string;
    }) =>
      orders.fulfillmentOrder.reportShortPick(
        shipmentId,
        data,
        commandKey(idempotencyKey)
      ),
    onSuccess: (_, { shipmentId }) =>
      invalidateShipment(queryClient, shipmentId),
  });
};
useReportShipmentShortPick.permission = ['fulfillment.shipment.reopen', 'fulfillment.shipment.short_pick'] as const satisfies PermissionRequirement;

export const useCreateShipmentConsolidation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      data,
      idempotencyKey,
    }: {
      data: CreateShipmentConsolidationRequest;
      idempotencyKey?: string;
    }) =>
      orders.consolidation.createShipmentConsolidation(
        data,
        commandKey(idempotencyKey)
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipments'] });
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.fulfillments });
    },
  });
};
useCreateShipmentConsolidation.permission = ['fulfillment.shipment.consolidate'] as const satisfies PermissionRequirement;

export const useCreateConsolidation = useCreateShipmentConsolidation;

export const useShipmentInspectionScan = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      shipmentId,
      data,
      idempotencyKey,
    }: {
      shipmentId: string;
      data: ShipmentInspectionScanRequest;
      idempotencyKey?: string;
    }) =>
      orders.inspection.scanShipment(
        shipmentId,
        data,
        commandKey(idempotencyKey)
      ),
    onSuccess: (_, { shipmentId }) =>
      invalidateShipment(queryClient, shipmentId),
  });
};
useShipmentInspectionScan.permission = ['fulfillment.warehouse.operate'] as const satisfies PermissionRequirement;

export const useForceShipmentDispatch = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      shipmentId,
      data,
      idempotencyKey,
    }: {
      shipmentId: string;
      data: ForceShipmentDispatchRequest;
      idempotencyKey?: string;
    }) =>
      orders.inspection.forceShipmentDispatch(
        shipmentId,
        data,
        commandKey(idempotencyKey)
      ),
    onSuccess: (_, { shipmentId }) =>
      invalidateShipment(queryClient, shipmentId),
  });
};
useForceShipmentDispatch.permission = ['fulfillment.dispatch.force'] as const satisfies PermissionRequirement;

// ===== Outbound batch V2 / strategy picking =====

function invalidateBatchV2(
  queryClient: ReturnType<typeof useQueryClient>,
  batchId: string
) {
  queryClient.invalidateQueries({
    queryKey: orderQueryKeys.outboundBatchV2(batchId),
  });
  queryClient.invalidateQueries({
    queryKey: orderQueryKeys.outboundBatchesV2Root,
  });
}

export const useCreateOutboundBatchV2 = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      data,
      idempotencyKey,
    }: {
      data: CreateOutboundBatchV2Request;
      idempotencyKey?: string;
    }) => orders.outboundBatches.createV2(data, commandKey(idempotencyKey)),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.outboundBatchesV2Root,
      }),
  });
};
useCreateOutboundBatchV2.permission = ['fulfillment.warehouse.operate'] as const satisfies PermissionRequirement;

export const useAddShipmentToBatch = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      batchId,
      shipmentId,
      idempotencyKey,
    }: {
      batchId: string;
      shipmentId: string;
      idempotencyKey?: string;
    }) =>
      orders.outboundBatches.addShipment(
        batchId,
        shipmentId,
        commandKey(idempotencyKey)
      ),
    onSuccess: (_, { batchId }) => invalidateBatchV2(queryClient, batchId),
  });
};
useAddShipmentToBatch.permission = ['fulfillment.warehouse.operate'] as const satisfies PermissionRequirement;

export const useExcludeShipmentFromBatch = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      batchId,
      shipmentId,
      reason,
      idempotencyKey,
    }: {
      batchId: string;
      shipmentId: string;
      reason: string;
      idempotencyKey?: string;
    }) =>
      orders.outboundBatches.excludeShipment(
        batchId,
        shipmentId,
        reason,
        commandKey(idempotencyKey)
      ),
    onSuccess: (_, { batchId }) => invalidateBatchV2(queryClient, batchId),
  });
};
useExcludeShipmentFromBatch.permission = ['fulfillment.warehouse.operate'] as const satisfies PermissionRequirement;

function workItemClaimMutation(kind: 'picker' | 'packer') {
  return () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({
        workItemId,
        data,
        idempotencyKey,
      }: {
        batchId: string;
        workItemId: string;
        data: ClaimBatchWorkItemRequest;
        idempotencyKey?: string;
      }) =>
        kind === 'picker'
          ? orders.outboundBatches.claimPicker(
              workItemId,
              data,
              commandKey(idempotencyKey)
            )
          : orders.outboundBatches.claimPacker(
              workItemId,
              data,
              commandKey(idempotencyKey)
            ),
      onSuccess: (_, { batchId }) => invalidateBatchV2(queryClient, batchId),
    });
  };
}

export const useClaimBatchPicker = Object.assign(
  workItemClaimMutation('picker'),
  { permission: ['fulfillment.warehouse.operate'] as const satisfies PermissionRequirement },
);
export const useClaimBatchPacker = Object.assign(
  workItemClaimMutation('packer'),
  { permission: ['fulfillment.warehouse.operate'] as const satisfies PermissionRequirement },
);

export const useHandoffBatchWorkItem = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      workItemId,
      data,
      idempotencyKey,
    }: {
      batchId: string;
      workItemId: string;
      data: HandoffBatchWorkItemRequest;
      idempotencyKey?: string;
    }) =>
      orders.outboundBatches.handoffWorkItem(
        workItemId,
        data,
        commandKey(idempotencyKey)
      ),
    onSuccess: (_, { batchId }) => invalidateBatchV2(queryClient, batchId),
  });
};
useHandoffBatchWorkItem.permission = ['fulfillment.warehouse.operate'] as const satisfies PermissionRequirement;

function pickingMutation<T extends { batchId: string }>(
  mutationFn: (data: T, key: string) => Promise<unknown>
) {
  return () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({
        data,
        idempotencyKey,
      }: {
        data: T;
        idempotencyKey?: string;
      }) => mutationFn(data, commandKey(idempotencyKey)),
      onSuccess: (_, { data }) => invalidateBatchV2(queryClient, data.batchId),
    });
  };
}

export const useStartPickingV2 = Object.assign(
  pickingMutation<StartPickingV2Request>(
    orders.picking.startV2
  ),
  { permission: ['fulfillment.warehouse.operate'] as const satisfies PermissionRequirement },
);
export const useDiscretePickingScan = Object.assign(
  pickingMutation<DiscretePickingScanRequest>(orders.picking.scanV2),
  { permission: ['fulfillment.warehouse.operate'] as const satisfies PermissionRequirement },
);
export const usePickingHandoff = Object.assign(
  pickingMutation<PickingHandoffRequest>(
    orders.picking.handoffV2
  ),
  { permission: ['fulfillment.warehouse.operate'] as const satisfies PermissionRequirement },
);
export const useCompletePickingV2 = Object.assign(
  pickingMutation<CompletePickingRequest>(
    orders.picking.completeV2
  ),
  { permission: ['fulfillment.warehouse.operate'] as const satisfies PermissionRequirement },
);
export const useAggregateBulkCartScan = Object.assign(
  pickingMutation<AggregateBulkCartScanRequest>(
      orders.picking.aggregateBulkCartScan
    ),
  { permission: ['fulfillment.warehouse.operate'] as const satisfies PermissionRequirement },
);
export const useAggregateSortScan = Object.assign(
  pickingMutation<AggregateSortScanRequest>(
    orders.picking.aggregateSortScan
  ),
  { permission: ['fulfillment.warehouse.operate'] as const satisfies PermissionRequirement },
);
export const useAggregateCartHandoff = Object.assign(
  pickingMutation<AggregateCartHandoffRequest>(
      orders.picking.aggregateCartHandoff
    ),
  { permission: ['fulfillment.warehouse.operate'] as const satisfies PermissionRequirement },
);
export const useRegisterTote = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      data,
      idempotencyKey,
    }: {
      data: RegisterToteRequest;
      idempotencyKey?: string;
    }) => orders.picking.registerTote(data, commandKey(idempotencyKey)),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.outboundBatchesV2Root,
      }),
  });
};
useRegisterTote.permission = ['fulfillment.warehouse.operate'] as const satisfies PermissionRequirement;
export const useAssignTote = Object.assign(
  pickingMutation<AssignToteRequest>(
    orders.picking.assignTote
  ),
  { permission: ['fulfillment.warehouse.operate'] as const satisfies PermissionRequirement },
);
export const useToteScan = Object.assign(
  pickingMutation<ToteScanRequest>(
    orders.picking.scanTote
  ),
  { permission: ['fulfillment.warehouse.operate'] as const satisfies PermissionRequirement },
);
export const useToteHandoff = Object.assign(
  pickingMutation<ToteHandoffRequest>(
    orders.picking.handoffTote
  ),
  { permission: ['fulfillment.warehouse.operate'] as const satisfies PermissionRequirement },
);
export const useReleaseTote = Object.assign(
  pickingMutation<ReleaseToteRequest>(
    orders.picking.releaseTote
  ),
  { permission: ['fulfillment.warehouse.operate'] as const satisfies PermissionRequirement },
);

// ===== Waybill (운송장) 발급 =====

export const useIssueWaybill = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      shipmentId,
      data,
      idempotencyKey,
    }: {
      shipmentId: string;
      data: IssueWaybillRequest;
      idempotencyKey?: string;
    }) => orders.waybills.issue(shipmentId, data, commandKey(idempotencyKey)),
    onSuccess: (_, { shipmentId }) =>
      invalidateShipment(queryClient, shipmentId),
  });
};
useIssueWaybill.permission = ['fulfillment.warehouse.operate'] as const satisfies PermissionRequirement;

export const useRegisterManualWaybill = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      shipmentId,
      data,
      idempotencyKey,
    }: {
      shipmentId: string;
      data: RegisterManualWaybillRequest;
      idempotencyKey?: string;
    }) => orders.waybills.manual(shipmentId, data, commandKey(idempotencyKey)),
    onSuccess: (_, { shipmentId }) =>
      invalidateShipment(queryClient, shipmentId),
  });
};
useRegisterManualWaybill.permission = ['fulfillment.warehouse.operate'] as const satisfies PermissionRequirement;

export const useReissueWaybill = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      shipmentId,
      data,
      idempotencyKey,
    }: {
      shipmentId: string;
      data: IssueWaybillRequest;
      idempotencyKey?: string;
    }) => orders.waybills.reissue(shipmentId, data, commandKey(idempotencyKey)),
    onSuccess: (_, { shipmentId }) =>
      invalidateShipment(queryClient, shipmentId),
  });
};
useReissueWaybill.permission = ['fulfillment.warehouse.operate'] as const satisfies PermissionRequirement;

export const useVoidWaybill = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      waybillId,
      data,
      idempotencyKey,
    }: {
      waybillId: string;
      shipmentId?: string;
      data: VoidWaybillRequest;
      idempotencyKey?: string;
    }) => orders.waybills.void(waybillId, data, commandKey(idempotencyKey)),
    onSuccess: (_, vars) => {
      if (vars.shipmentId) invalidateShipment(queryClient, vars.shipmentId);
    },
  });
};
useVoidWaybill.permission = ['fulfillment.shipment.reopen'] as const satisfies PermissionRequirement;

export const useBatchIssueWaybills = () =>
  useMutation({
    mutationFn: ({
      data,
      idempotencyKey,
    }: {
      data: IssueBatchWaybillRequest;
      idempotencyKey?: string;
    }) => orders.waybills.batch(data, commandKey(idempotencyKey)),
  });
useBatchIssueWaybills.permission = ['fulfillment.warehouse.operate'] as const satisfies PermissionRequirement;

// ===== 반영 대기 채널 변경 닫기 (#1016 6번 행) =====
// 성공이든 409(그 사이 superseded·이미 닫힘)든 목록을 다시 불러온다 — 409 면 지금 상태가 답이다.

// 무시·다시 확인: 409(이미 닫힘·새 변경에 대체됨)는 다시 읽은 목록이 답이라 알리지 않고, 그 밖의 실패만 알린다.
// toast 를 mutate 호출별 콜백이 아니라 여기 두는 건, 호출별 콜백은 마지막 호출에만 불려 다른 행을 연달아 누르면 앞 실패가 묻히기 때문이다.
export const useDismissChannelChange = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) => orders.amendments.dismiss(id, note),
    onError: (error) => {
      if (!isConflict(error)) toast.error('무시하지 못했습니다.');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.amendments });
    },
  });
};
useDismissChannelChange.permission = ['order.order.write'] as const satisfies PermissionRequirement;

export const useResyncChannelChange = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => orders.amendments.resync(id),
    onError: (error) => {
      if (!isConflict(error)) toast.error('다시 확인을 요청하지 못했습니다.');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.amendments });
    },
  });
};
useResyncChannelChange.permission = ['order.order.write'] as const satisfies PermissionRequirement;

/** 채널 취소 정산 [다시 시도] (#1016 36번 재설계) */
export const useRetryCancelSettlement = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: { salesOrderId: string; requestId: string; alreadyRefundedAmount?: number }) =>
      orders.salesOrders.retryCancelSettlement(v.salesOrderId, v.requestId, v.alreadyRefundedAmount),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-progress'] });
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
    },
  });
};
useRetryCancelSettlement.permission = ['payment.refund.execute'] as const satisfies PermissionRequirement;

/** 채널 취소 정산 [계좌 송금으로 환불] */
export const useManualRefundCancelSettlement = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: { salesOrderId: string; requestId: string }) =>
      orders.salesOrders.manualRefundCancelSettlement(v.salesOrderId, v.requestId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-progress'] });
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
    },
  });
};
useManualRefundCancelSettlement.permission = ['payment.refund.execute'] as const satisfies PermissionRequirement;
