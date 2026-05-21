// src/lib/services/orders/mutations.ts
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { orderQueryKeys } from './query-keys';
import { orders } from '@/lib/api/domains';
import type {
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

export const useDeleteSalesOrder = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => orders.salesOrders.cancelSalesOrder(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.orders });
      queryClient.removeQueries({ queryKey: orderQueryKeys.order(id) });
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
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.pickingSession(foId) });
    },
  });
};

export const usePickIndividualItem = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ foiId, data }: { foiId: string; data: PickIndividualItemRequest }) =>
      orders.picking.pickIndividualItem(foiId, data),
    onSuccess: (_, { foiId }) => {
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.pickings });
    },
  });
};

export const useCompleteIndividualPicking = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (foId: string) => orders.picking.completeIndividualPicking(foId),
    onSuccess: (_, foId) => {
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.pickingSession(foId) });
    },
  });
};

export const useResetPickingItem = () => {
  return useMutation({
    mutationFn: (foiId: string) => orders.picking.resetPickingForItem(foiId),
  });
};

export const useBatchPick = () => {
  return useMutation({
    mutationFn: (data: BatchPickRequest) => orders.picking.batchPick(data),
  });
};

export const useScanBarcode = () => {
  return useMutation({
    mutationFn: (data: ScanBarcodeRequest) => orders.picking.scanBarcode(data),
  });
};

export const usePickByBarcode = () => {
  return useMutation({
    mutationFn: (data: PickByBarcodeRequest) => orders.picking.pickByBarcodeScan(data),
  });
};

export const useGenerateBarcode = () => {
  return useMutation({
    mutationFn: (data: GenerateBarcodeRequest) => orders.picking.generateBarcode(data),
  });
};

// ===== 검수 관련 뮤테이션 =====

export const useStartInspection = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: StartInspectionRequest) => orders.inspection.startSession(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspection'] });
    },
  });
};

export const useCompleteInspectionSession = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, data }: { sessionId: string; data: CompleteInspectionSessionRequest }) =>
      orders.inspection.completeSession(sessionId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspection'] });
    },
  });
};

export const useInspectItem = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: InspectItemRequest) => orders.inspection.inspectItem(data),
    onSuccess: (_, data) => {
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.inspectionSummary(data.sessionId) });
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.inspectionHistory(data.foiId) });
    },
  });
};

export const useForceShipment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ForceShipmentRequest) => orders.inspection.forceShipment(data),
    onSuccess: (_, data) => {
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.inspectionHistory(data.foiId) });
    },
  });
};

export const useResetInspection = () => {
  return useMutation({
    mutationFn: ({ foiId, inspectorUserId }: { foiId: string; inspectorUserId: string }) =>
      orders.inspection.resetInspection(foiId, inspectorUserId),
  });
};

export const useBulkApprove = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: BulkApproveRequest) => orders.inspection.bulkApprove(data),
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
 * 매칭 대기 해소 (SKU와 매칭 또는 무시)
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
 * 매칭 대기 우선순위 설정
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
 * 매칭 무시 처리 (편의 함수)
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
          ignore: true,
          strategy: 'variant',
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
 * 매칭 완료 처리 (편의 함수)
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
    mutationFn: (data: CreateOutboundBatchRequest) => orders.outboundBatches.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.outboundBatches });
    },
  });
};

export const useAddFOsToBatch = (batchId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: AddFOsToBatchRequest) =>
      orders.outboundBatches.addFulfillmentOrders(batchId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.outboundBatch(batchId) });
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.outboundBatches });
    },
  });
};

export const useRemoveFOFromBatch = (batchId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (foId: string) => orders.outboundBatches.removeFulfillmentOrder(batchId, foId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.outboundBatch(batchId) });
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.outboundBatches });
    },
  });
};

export const useStartBatchPicking = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (batchId: string) => orders.outboundBatches.startPicking(batchId),
    onSuccess: (_, batchId) => {
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.outboundBatch(batchId) });
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.outboundBatches });
    },
  });
};

export const useCompleteBatch = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (batchId: string) => orders.outboundBatches.complete(batchId),
    onSuccess: (_, batchId) => {
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.outboundBatch(batchId) });
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.outboundBatches });
    },
  });
};

export const useCancelBatch = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (batchId: string) => orders.outboundBatches.cancel(batchId),
    onSuccess: (_, batchId) => {
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.outboundBatch(batchId) });
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.outboundBatches });
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
    mutationFn: (companyName: string) => orders.directShip.exportFile(companyName),
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
    mutationFn: (groupId: string) => orders.consolidation.autoConsolidate(groupId),
  });
};
