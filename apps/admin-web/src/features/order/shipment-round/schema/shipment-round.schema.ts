/** @format */

import { z } from 'zod';

// 운송장 번호, 주문번호, 상품명
export enum SearchType {
  COURIER_NUMBER = 'courierNumber',
  ORDER_NUMBER = 'orderNumber',
  PRODUCT_NAME = 'productName',
}

export enum shippingBatch {
  BATCH1 = '1',
  BATCH2 = '2',
  BATCH3 = '3',
}

export const shipmentRoundFilterSchema = z
  .object({
    // 조회기간
    startDate: z.date().optional(),
    endDate: z.date().optional(),

    // 회차
    shippingBatch: z.enum(shippingBatch).optional(),

    // 피킹 담당자
    pickingManager: z.string().optional(),

    // 받는분 이름
    receiverName: z.string().optional(),

    // 조건검색
    searchType: z.enum(SearchType).optional(),
    searchValue: z.string().optional(),
  })
  .refine(
    (data) => {
      if (
        data.searchType &&
        (!data.searchValue || data.searchValue.length === 0)
      ) {
        return false;
      }
      return true;
    },
    {
      message: '해당 조건에 맞는 필드값을 입력해주세요',
      path: ['searchValue'],
    }
  )
  .refine(
    (data) => {
      if (data.endDate && !data.startDate) {
        return false;
      }

      return true;
    },
    {
      message: '조회기간 시작일을 선택해주세요',
      path: ['startDate'],
    }
  );

export type ShipmentRoundFilter = z.infer<typeof shipmentRoundFilterSchema>;
