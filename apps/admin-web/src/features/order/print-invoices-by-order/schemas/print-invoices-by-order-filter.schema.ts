/** @format */

import { z } from 'zod';

// 판매처 온,오프라인 분류
export enum SellerOnlineOrOffline {
  ONLINE = 'online',
  OFFLINE = 'offline',
  ALL = 'all',
}

// 판매처 목록
export enum SellerType {
  NAVER = 'naver',
  CUPANG = 'cupang',
  ALL = 'all',
}

// 조회 기간 타입
export enum PeriodType {
  REQUESTED_SHIPMENT_DATE = 'requestedShipmentDate', // 출고요청일
  ORDER_DATE = 'orderDate', // 주문일
  DELIVERY_DATE = 'deliveryDate', // 배송일
}

// 출고 방식
export enum ShippingMethod {
  PARCEL_DELIVERY = 'parcelDelivery', // 택배
  QUICK_SERVICE = 'quickService', // 퀵
  VISIT_PICKUP = 'visitPickup', // 방문수령
}

// 출고 회차
export enum ShippingBatch {
  BATCH1 = '1',
  BATCH2 = '2',
  BATCH3 = '3',
}

// 조건 검색
export enum ConditionField {
  ORDER_NUMBER = 'orderNumber', // 주문번호
  PHONE_NUMBER = 'phoneNumber', // 전화번호
  ADDRESS = 'address', // 주소
}

// 진행 상태
export enum ProgressStatus {
  REQUEST = 'request', // 출고요청
  ORDER = 'order', // 주문
  WORKING = 'working', // 배송중
  DONE = 'done', // 배송완료
  CANCEL = 'cancel', // 출고취소
}

// 검색 타입
export enum SearchType {
  EXACT = 'exact',
  INCLUDE = 'include',
}

export const printInvoicesByOrderFilterSchema = z
  .object({
    sellerOnlineOrOffline: z.enum(SellerOnlineOrOffline).optional(),
    seller: z.enum(SellerType).optional(),
    periodType: z.enum(PeriodType).optional(),
    startDate: z.date().optional(),
    endDate: z.date().optional(),
    shippingMethod: z.enum(ShippingMethod).optional(),
    shippingBatch: z.enum(ShippingBatch).optional(),
    conditionField: z.enum(ConditionField).optional(),
    conditionValue: z.string().optional(),
    receiverName: z.string().optional(),
    productCountMin: z.number().optional(),
    productCountMax: z.number().optional(),
    progressStatus: z.object({
      request: z.boolean(),
      order: z.boolean(),
      working: z.boolean(),
      done: z.boolean(),
      cancel: z.boolean(),
    }),
    searchType: z.enum(SearchType).optional(),
    keyword: z.string().optional(),
  })
  .refine(
    (data) => {
      // shippingMethod가 선택되어 있으면 shippingBatch도 필수
      if (data.shippingMethod && !data.shippingBatch) {
        return false;
      }
      return true;
    },
    {
      message: '출고회차를 선택해주세요',
      path: ['shippingBatch'],
    }
  )
  .refine(
    (data) => {
      // shippingBatch가 선택되어 있으면 shippingMethod도 필수
      if (data.shippingBatch && !data.shippingMethod) {
        return false;
      }
      return true;
    },
    {
      message: '출고방식을 선택해주세요',
      path: ['shippingMethod'],
    }
  )
  .refine(
    (data) => {
      if (data.conditionValue && data.conditionValue.length !== 0) {
        return false;
      }

      return true;
    },
    {
      message: '조건검색을 설정해주세요',
      path: ['conditionField'],
    }
  )
  .refine(
    (data) => {
      if (data.productCountMin && data.productCountMin <= 0) return false;

      return true;
    },
    {
      message: '최소 상품 수는 0보다 크게 입력해주세요',
      path: ['productCountMin'],
    }
  )
  .refine(
    (data) => {
      if (
        data.productCountMin &&
        data.productCountMax &&
        data.productCountMax <= data.productCountMin
      )
        return false;

      return true;
    },
    {
      message: '최대 상품 수는 최소 상품 수보다 작게 입력해주세요',
      path: ['productCountMax'],
    }
  )
  .refine(
    (data) => {
      return Object.values(data.progressStatus).some(Boolean);
    },
    {
      message: '진행상태를 하나이상 선택해주세요',
      path: ['progressStatus'],
    }
  );

export type PrintInvoicesByOrderFilter = z.infer<
  typeof printInvoicesByOrderFilterSchema
>;
