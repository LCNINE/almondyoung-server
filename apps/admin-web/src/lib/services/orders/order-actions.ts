// src/lib/services/orders/order-actions.ts
// 주문 관련 액션 헬퍼 함수들

// TODO: WMS API 추가 필요
// ================================================================================================
// 현재 WMS의 PATCH /sales-orders/:id (UpdateSalesOrderDto)는 다음 필드만 지원:
//   - customer (CustomerDto)
//   - shippingAddress (AddressDto)
//   - totalAmount (number)
//   - shippingFee (number)
//   - processedAt (string)
//   - memo (string)
//
// ❌ items/lines 필드가 없어서 주문 상품 추가/삭제/수정이 불가능합니다.
//
// 필요한 WMS API 추가 사항:
// ------------------------------------------------------------------------------------------------
// 1. PATCH /sales-orders/:id/lines
//    - 주문 라인(상품) 전체를 교체하는 API
//    - Request Body: { lines: CreateSalesOrderLineDto[] }
//    - 기존 라인을 모두 삭제하고 새 라인으로 교체
//    - 또는 개별 라인 추가/삭제/수정 API를 분리해도 됨
//
// 2. POST /sales-orders/:id/lines
//    - 개별 상품 추가 API
//    - Request Body: CreateSalesOrderLineDto
//
// 3. PATCH /sales-orders/:id/lines/:lineId
//    - 개별 상품 수량/가격 수정 API
//    - Request Body: { quantity?: number; unitPrice?: number }
//
// 4. DELETE /sales-orders/:id/lines/:lineId
//    - 개별 상품 삭제 API
//
// 5. POST /sales-orders/:id/split
//    - 주문 분할 전용 API (원자적 처리)
//    - Request Body: { lineIds: string[] } or { lines: Array<{ lineId: string; quantity: number }> }
//    - 응답: { originalOrder: SalesOrder; newOrder: SalesOrder }
//
// 참고:
// - apps/wms/src/order/sales-orders/dto/update-sales-order.dto.ts 수정 필요
// - apps/wms/src/order/sales-orders/dto/create-sales-order-line.dto.ts 재사용 가능
// - apps/wms/src/order/sales-orders/services/sales-orders.service.ts에 메서드 추가
// - apps/wms/src/order/sales-orders/controllers/sales-orders.controller.ts에 엔드포인트 추가
// ================================================================================================

import { orders } from '@/lib/api/domains';
import type { UpdateSalesOrderDto, CreateSalesOrderDto } from '@/lib/types/dto/orders';

/**
 * 주문 분할 (나누기)
 * 한 주문을 여러 주문으로 분할
 * - 동일한 주문번호 유지 (channelOrderId는 동일)
 * - 수령자명 뒤에 -1, -2 등 추가
 * 
 * TODO: WMS에 POST /sales-orders/:id/split API 추가 필요
 */
export const splitOrder = async (params: {
  orderId: string;
  selectedLineIds: string[];
  originalOrder: any;
}): Promise<{ success: boolean; newOrderId?: string; error?: string }> => {
  // TODO: WMS API 추가 후 구현
  return { 
    success: false, 
    error: 'WMS API 추가 필요: POST /sales-orders/:id/split' 
  };

  /* 구현 예정 코드 (WMS API 추가 후)
  const { orderId, selectedLineIds, originalOrder } = params;

  try {
    const selectedLines = originalOrder.lines.filter((line: any) =>
      selectedLineIds.includes(line.id)
    );

    if (selectedLines.length === 0) {
      return { success: false, error: '분할할 상품을 선택해주세요.' };
    }

    const newOrderData: CreateSalesOrderDto = {
      customerId: originalOrder.customerId,
      warehouseId: originalOrder.warehouseId || 'WH001',
      items: selectedLines.map((line: any) => ({
        skuId: line.skuId || line.variantId,
        quantity: line.quantity,
        unitPrice: line.unitPrice || 0,
      })),
      memo: `${originalOrder.channelOrderId} 분할 주문`,
    };

    const newOrder = await orders.salesOrders.createSalesOrder(newOrderData);

    const remainingLines = originalOrder.lines.filter(
      (line: any) => !selectedLineIds.includes(line.id)
    );

    if (remainingLines.length > 0) {
      await orders.salesOrders.updateSalesOrder(orderId, {
        items: remainingLines.map((line: any) => ({
          skuId: line.skuId || line.variantId,
          quantity: line.quantity,
          unitPrice: line.unitPrice || 0,
        })),
      });
    }

    return { success: true, newOrderId: newOrder.id };
  } catch (error: any) {
    return { success: false, error: error.message || '주문 분할 중 오류가 발생했습니다.' };
  }
  */
};

/**
 * 수량 나누기
 * 특정 상품의 수량을 새 주문으로 분리
 * 
 * TODO: WMS에 POST /sales-orders/:id/split API 또는 PATCH /sales-orders/:id/lines API 추가 필요
 */
export const splitQuantity = async (params: {
  orderId: string;
  splits: Array<{ lineId: string; splitQty: number }>;
  originalOrder: any;
}): Promise<{ success: boolean; newOrderId?: string; error?: string }> => {
  // TODO: WMS API 추가 후 구현
  return { 
    success: false, 
    error: 'WMS API 추가 필요: PATCH /sales-orders/:id/lines' 
  };

  /* 구현 예정 코드 (WMS API 추가 후)
  const { orderId, splits, originalOrder } = params;

  try {
    const itemsToSplit = splits.filter((s) => s.splitQty > 0);
    
    if (itemsToSplit.length === 0) {
      return { success: false, error: '분리할 수량을 입력해주세요.' };
    }

    const newOrderLines: any[] = [];
    originalOrder.lines.forEach((line: any) => {
      const split = itemsToSplit.find((s) => s.lineId === line.id);
      if (split && split.splitQty > 0) {
        newOrderLines.push({
          skuId: line.skuId || line.variantId,
          quantity: split.splitQty,
          unitPrice: line.unitPrice || 0,
        });
      }
    });

    const newOrderData: CreateSalesOrderDto = {
      customerId: originalOrder.customerId,
      warehouseId: originalOrder.warehouseId || 'WH001',
      items: newOrderLines,
      memo: `${originalOrder.channelOrderId} 수량 분리`,
    };

    const newOrder = await orders.salesOrders.createSalesOrder(newOrderData);

    const updatedLines = originalOrder.lines.map((line: any) => {
      const split = itemsToSplit.find((s) => s.lineId === line.id);
      const remainQty = split ? line.quantity - split.splitQty : line.quantity;
      
      return {
        skuId: line.skuId || line.variantId,
        quantity: Math.max(0, remainQty),
        unitPrice: line.unitPrice || 0,
      };
    }).filter((item: any) => item.quantity > 0);

    if (updatedLines.length > 0) {
      await orders.salesOrders.updateSalesOrder(orderId, {
        items: updatedLines,
      });
    }

    return { success: true, newOrderId: newOrder.id };
  } catch (error: any) {
    return { success: false, error: error.message || '수량 분리 중 오류가 발생했습니다.' };
  }
  */
};

/**
 * 주문 정보 수정 (입력확인)
 * 
 * 현재는 메모만 수정 가능
 * TODO: WMS에 PATCH /sales-orders/:id/lines API 추가되면 상품 수정도 지원
 */
export const updateOrderDetails = async (params: {
  orderId: string;
  updatedOrder: any;
}): Promise<{ success: boolean; error?: string }> => {
  const { orderId, updatedOrder } = params;

  try {
    // 현재는 메모만 수정 가능
    await orders.salesOrders.updateSalesOrder(orderId, {
      memo: updatedOrder.memo,
    });

    // TODO: WMS API 추가 후 items도 수정 가능하도록
    // await orders.salesOrders.updateSalesOrderLines(orderId, {
    //   items: updatedOrder.lines.map((line: any) => ({
    //     skuId: line.skuId || line.variantId,
    //     quantity: line.quantity,
    //     unitPrice: line.unitPrice || 0,
    //   })),
    // });

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || '주문 수정 중 오류가 발생했습니다.' };
  }
};

/**
 * 주문에 상품 추가
 * 
 * TODO: WMS에 POST /sales-orders/:id/lines API 추가 필요
 */
export const addOrderItem = async (params: {
  orderId: string;
  newItem: { skuId: string; quantity: number; unitPrice?: number };
  originalOrder: any;
}): Promise<{ success: boolean; error?: string }> => {
  // TODO: WMS API 추가 후 구현
  return { 
    success: false, 
    error: 'WMS API 추가 필요: POST /sales-orders/:id/lines' 
  };

  /* 구현 예정 코드 (WMS API 추가 후)
  const { orderId, newItem, originalOrder } = params;

  try {
    const existingLines = originalOrder.lines.map((line: any) => ({
      skuId: line.skuId || line.variantId,
      quantity: line.quantity,
      unitPrice: line.unitPrice || 0,
    }));

    const updatedLines = [
      ...existingLines,
      {
        skuId: newItem.skuId,
        quantity: newItem.quantity,
        unitPrice: newItem.unitPrice || 0,
      },
    ];

    await orders.salesOrders.updateSalesOrder(orderId, {
      items: updatedLines,
    });

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || '상품 추가 중 오류가 발생했습니다.' };
  }
  */
};
