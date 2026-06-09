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
  IssueInvoiceRequest,
  PrintInvoicesRequest,
  BatchPickRequest,
  PickByBarcodeRequest,
  PickIndividualItemRequest,
  ScanBarcodeRequest,
  GenerateBarcodeRequest,
  CreateOutboundBatchRequest,
  AddFOsToBatchRequest,
  ForwardDirectShipOrdersRequest,
  CompleteDirectShipOrdersRequest,
  CreateStandaloneFulfillmentRequest,
  SplitFulfillmentOrderRequest,
  ReserveRequest,
  UnreserveRequest,
  TransferReservationRequest,
  AssignShipmentRequest,
  InspectByScanRequest,
} from '@/lib/types/dto/fulfillment';

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

// 레거시 stub — D2 useCreateOutboundBatch로 대체됨

export const useUpdateOutboundBatch = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      Promise.resolve({ id, ...data }),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.outboundBatches,
      });
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.outboundBatch(id),
      });
    },
  });
};

export const useDeleteOutboundBatch = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => Promise.resolve(),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.outboundBatches,
      });
      queryClient.removeQueries({ queryKey: orderQueryKeys.outboundBatch(id) });
    },
  });
};

// ===== 피킹 관련 뮤테이션 =====

export const useStartIndividualPicking = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (foId: string) => orders.picking.startIndividualPicking(foId),
    onSuccess: (_, foId) => {
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.pickingSession(foId),
      });
    },
  });
};

export const usePickIndividualItem = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      foiId,
      data,
    }: {
      foiId: string;
      data: PickIndividualItemRequest;
    }) => orders.picking.pickIndividualItem(foiId, data),
    onSuccess: (_, { foiId }) => {
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.pickings });
    },
  });
};

export const useCompleteIndividualPicking = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (foId: string) =>
      orders.picking.completeIndividualPicking(foId),
    onSuccess: (_, foId) => {
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.pickingSession(foId),
      });
    },
  });
};

export const useResetPickingItem = () => {
  return useMutation({
    mutationFn: (foiId: string) => orders.picking.resetPickingForItem(foiId),
  });
};

export const useBatchPick = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: BatchPickRequest) => orders.picking.batchPick(data),
    onSuccess: (_data, variables) => {
      // 피킹 반영 후 집계/진행률을 다시 불러와 화면(뱃지·진행률)이 갱신되도록 한다.
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.batchOperations(variables.batchId),
      });
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.batchProgress(variables.batchId),
      });
    },
  });
};

export const useScanBarcode = () => {
  return useMutation({
    mutationFn: (data: ScanBarcodeRequest) => orders.picking.scanBarcode(data),
  });
};

export const usePickByBarcode = () => {
  return useMutation({
    mutationFn: (data: PickByBarcodeRequest) =>
      orders.picking.pickByBarcodeScan(data),
  });
};

export const useGenerateBarcode = () => {
  return useMutation({
    mutationFn: (data: GenerateBarcodeRequest) =>
      orders.picking.generateBarcode(data),
  });
};

// ===== 출고주문(FO) 액션 뮤테이션 =====

// FO 상세/목록 캐시 무효화 공통 처리
const useInvalidateFulfillment = () => {
  const queryClient = useQueryClient();
  return (id: string) => {
    queryClient.invalidateQueries({ queryKey: orderQueryKeys.fulfillment(id) });
    queryClient.invalidateQueries({ queryKey: orderQueryKeys.fulfillments });
  };
};

export const useReserveFulfillmentItem = () => {
  const invalidate = useInvalidateFulfillment();
  return useMutation({
    mutationFn: ({
      id,
      fulfillmentOrderItemId,
      quantity,
    }: {
      id: string;
      fulfillmentOrderItemId: string;
      quantity: number;
    }) =>
      orders.fulfillmentOrder.reserveItem(id, {
        fulfillmentOrderItemId,
        quantity,
      }),
    onSuccess: (_, { id }) => invalidate(id),
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

// ===== 송장 관련 뮤테이션 =====

export const useIssueInvoice = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: IssueInvoiceRequest) => orders.invoices.issue(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.invoices });
    },
  });
};

export const usePrintInvoices = () => {
  return useMutation({
    mutationFn: (data: PrintInvoicesRequest) => orders.invoices.print(data),
  });
};

export const useMarkInvoiceShipped = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => orders.invoices.ship(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.invoice(id) });
    },
  });
};

export const useCancelInvoice = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => orders.invoices.cancel(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.invoice(id) });
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

// ===== 출고 배치 뮤테이션 (D2) =====

export const useCreateOutboundBatch = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateOutboundBatchRequest) =>
      orders.outboundBatches.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.outboundBatches,
      });
    },
  });
};

export const useAddFOsToBatch = (batchId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: AddFOsToBatchRequest) =>
      orders.outboundBatches.addFulfillmentOrders(batchId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.outboundBatch(batchId),
      });
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.outboundBatches,
      });
    },
  });
};

export const useRemoveFOFromBatch = (batchId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (foId: string) =>
      orders.outboundBatches.removeFulfillmentOrder(batchId, foId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.outboundBatch(batchId),
      });
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.outboundBatches,
      });
    },
  });
};

export const useStartBatchPicking = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (batchId: string) =>
      orders.outboundBatches.startPicking(batchId),
    onSuccess: (_, batchId) => {
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.outboundBatch(batchId),
      });
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.outboundBatches,
      });
    },
  });
};

export const useCompleteBatch = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (batchId: string) => orders.outboundBatches.complete(batchId),
    onSuccess: (_, batchId) => {
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.outboundBatch(batchId),
      });
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.outboundBatches,
      });
    },
  });
};

export const useCancelBatch = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (batchId: string) => orders.outboundBatches.cancel(batchId),
    onSuccess: (_, batchId) => {
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.outboundBatch(batchId),
      });
      queryClient.invalidateQueries({
        queryKey: orderQueryKeys.outboundBatches,
      });
    },
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

function invalidateFulfillment(queryClient: ReturnType<typeof useQueryClient>, id: string) {
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

export const useSplitFulfillmentOrder = (id: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: SplitFulfillmentOrderRequest) =>
      orders.fulfillments.split(id, data),
    onSuccess: () => {
      invalidateFulfillment(queryClient, id);
    },
  });
};

export const useCheckFulfillmentAvailability = (id: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => orders.fulfillments.checkAvailability(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.fulfillment(id) });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'reservations'] });
    },
  });
};

export const useReserveFulfillment = (id: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ReserveRequest) => orders.fulfillments.reserve(id, data),
    onSuccess: () => {
      invalidateFulfillment(queryClient, id);
    },
  });
};

export const useUnreserveFulfillment = (id: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UnreserveRequest) => orders.fulfillments.unreserve(id, data),
    onSuccess: () => {
      invalidateFulfillment(queryClient, id);
    },
  });
};

export const useTransferFulfillmentReservation = (id: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: TransferReservationRequest) =>
      orders.fulfillments.transferReservation(id, data),
    onSuccess: () => {
      invalidateFulfillment(queryClient, id);
    },
  });
};

export const useAssignFulfillmentShipment = (id: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: AssignShipmentRequest) =>
      orders.fulfillments.assignShipment(id, data),
    onSuccess: () => {
      invalidateFulfillment(queryClient, id);
    },
  });
};

export const useShipFulfillment = (boundId?: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id?: string) => {
      const targetId = boundId ?? id;
      if (!targetId) throw new Error('Fulfillment id is required');
      return orders.fulfillments.ship(targetId);
    },
    onSuccess: (_, id) => {
      invalidateFulfillment(queryClient, boundId ?? id!);
    },
  });
};

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
