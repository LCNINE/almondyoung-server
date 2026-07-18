// src/lib/services/orders/mutations.ts
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { orderQueryKeys } from './query-keys';
import { orders } from '@/lib/api/domains';
import type {
  CancelSalesOrderDto,
  ResolveMatchingDto,
  ResolveOptionMatchingDto,
  SetMatchingPriorityDto,
  ChangeStrategyDto,
  StockPolicyDto,
  VariantMatchingDto,
} from '@/lib/types/dto/orders';
import type {
  StartInspectionRequest,
  InspectItemRequest,
  ForceShipmentRequest,
  BulkApproveRequest,
  CompleteInspectionSessionRequest,
  ForwardDirectShipOrdersRequest,
  CompleteDirectShipOrdersRequest,
  CreateStandaloneFulfillmentRequest,
  InspectByScanRequest,
  SplitShipmentRequest,
  ReviseShipmentRecipientRequest,
  PlanShipmentRequest,
  CancelShipmentOutstandingRequest,
  RecallShipmentRequest,
  ReportShipmentShortPickRequest,
  CreateShipmentConsolidationRequest,
  ShipmentInspectionScanRequest,
  ForceShipmentDispatchRequest,
  CreateOutboundBatchV2Request,
  ClaimBatchWorkItemRequest,
  HandoffBatchWorkItemRequest,
  CreatePickingPlanRequest,
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
} from '@/lib/types/dto/fulfillment';

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

// ===== 검수 관련 뮤테이션 =====

export const useStartInspection = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: StartInspectionRequest) =>
      orders.inspection.startSession(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspection'] });
    },
  });
};

export const useCompleteInspectionSession = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      data,
    }: {
      sessionId: string;
      data: CompleteInspectionSessionRequest;
    }) => orders.inspection.completeSession(sessionId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspection'] });
    },
  });
};

export const useInspectItem = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: InspectItemRequest) =>
      orders.inspection.inspectItem(data),
    onSuccess: (_, data) => {
      queryClient.invalidateQueries({ queryKey: ['inspection'] });
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.inspectionHistory(data.foiId),
      });
    },
  });
};

export const useInspectByScan = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: InspectByScanRequest) =>
      orders.inspection.inspectByScan(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspection'] });
    },
  });
};

export const useForceShipment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ForceShipmentRequest) =>
      orders.inspection.forceShipment(data),
    onSuccess: (_, data) => {
      queryClient.invalidateQueries({ queryKey: ['inspection'] });
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.inspectionHistory(data.foiId),
      });
    },
  });
};

export const useResetInspection = () => {
  return useMutation({
    mutationFn: ({
      foiId,
      inspectorUserId,
    }: {
      foiId: string;
      inspectorUserId: string;
    }) => orders.inspection.resetInspection(foiId, inspectorUserId),
  });
};

export const useBulkApprove = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: BulkApproveRequest) =>
      orders.inspection.bulkApprove(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspection'] });
    },
  });
};

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

/**
 * 옵션별 매칭 해소
 */
export const useResolveOptionMatching = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: ResolveOptionMatchingDto;
    }) => orders.matching.resolveOptionMatching(id, data),
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

export const useExportDirectShipFile = () => {
  return useMutation({
    mutationFn: (companyName: string) =>
      orders.directShip.exportFile(companyName),
  });
};

// ===== 합포장 뮤테이션 (D2) =====

export const useAnalyzeConsolidation = (warehouseId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => orders.consolidation.analyze(warehouseId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.consolidationCandidates(warehouseId),
      });
    },
  });
};

export const useAutoConsolidate = () => {
  // ⚠️ STUB — 실제 FO 머지 안 함. UI에서 stub 경고 표시 필수
  return useMutation({
    mutationFn: (groupId: string) =>
      orders.consolidation.autoConsolidate(groupId),
  });
};

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

export const useCreateFulfillmentOrder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateStandaloneFulfillmentRequest) =>
      orders.fulfillmentOrder.createStandalone(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.fulfillments });
    },
  });
};

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

export const useCancelShipmentOutstanding = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      shipmentId,
      data,
      idempotencyKey,
    }: {
      shipmentId: string;
      data: CancelShipmentOutstandingRequest;
      idempotencyKey?: string;
    }) =>
      orders.fulfillmentOrder.cancelShipmentOutstanding(
        shipmentId,
        data,
        commandKey(idempotencyKey)
      ),
    onSuccess: (_, { shipmentId }) =>
      invalidateShipment(queryClient, shipmentId),
  });
};

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

export const useClaimBatchPicker = workItemClaimMutation('picker');
export const useClaimBatchPacker = workItemClaimMutation('packer');

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

export const useCreatePickingPlan = pickingMutation<CreatePickingPlanRequest>(
  orders.picking.createPlan
);
export const useStartPickingV2 = pickingMutation<StartPickingV2Request>(
  orders.picking.startV2
);
export const useDiscretePickingScan =
  pickingMutation<DiscretePickingScanRequest>(orders.picking.scanV2);
export const usePickingHandoff = pickingMutation<PickingHandoffRequest>(
  orders.picking.handoffV2
);
export const useCompletePickingV2 = pickingMutation<CompletePickingRequest>(
  orders.picking.completeV2
);
export const useAggregateBulkCartScan =
  pickingMutation<AggregateBulkCartScanRequest>(
    orders.picking.aggregateBulkCartScan
  );
export const useAggregateSortScan = pickingMutation<AggregateSortScanRequest>(
  orders.picking.aggregateSortScan
);
export const useAggregateCartHandoff =
  pickingMutation<AggregateCartHandoffRequest>(
    orders.picking.aggregateCartHandoff
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
export const useAssignTote = pickingMutation<AssignToteRequest>(
  orders.picking.assignTote
);
export const useToteScan = pickingMutation<ToteScanRequest>(
  orders.picking.scanTote
);
export const useToteHandoff = pickingMutation<ToteHandoffRequest>(
  orders.picking.handoffTote
);
export const useReleaseTote = pickingMutation<ReleaseToteRequest>(
  orders.picking.releaseTote
);

export const useDeliverFulfillment = (id: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => orders.fulfillments.deliver(id),
    onSuccess: () => {
      invalidateFulfillment(queryClient, id);
    },
  });
};

export const useCancelFulfillment = (boundId?: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id?: string) => {
      const targetId = boundId ?? id;
      if (!targetId) throw new Error('Fulfillment id is required');
      return orders.fulfillments.cancel(targetId);
    },
    onSuccess: (_, id) => {
      invalidateFulfillment(queryClient, boundId ?? id!);
    },
  });
};
