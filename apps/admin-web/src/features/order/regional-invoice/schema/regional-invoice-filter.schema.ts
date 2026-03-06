/** @format */

import { z } from 'zod';

export enum FilterPeriod {
  REQUESTED_SHIPMENT_DATE = 'requestedShipmentDate', // 출고요청일
  DESIRED_SHIPMENT_DATE = 'desiredShipmentDate', // 출고희망일
}

export const regionalInvoiceFilterSchema = z
  .object({
    sido: z.string(), // 시/도
    sigungu: z.string(), // 시/군/구
    filterPeriod: z.enum(FilterPeriod).optional(), // 출고요청일 or 출고희망일
    startDate: z.date().optional(), // 조회기간 시작일
    endDate: z.date().optional(), // 조회기간 종료일
    productCountMin: z.number().optional(), // 최소 상품 수
    productCountMax: z.number().optional(), // 최대 상품 수
  })
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
      if (!data.filterPeriod && (data.startDate || data.endDate)) return false;
      return true;
    },
    {
      message: '조회기간을 선택해주세요',
      path: ['filterPeriod'],
    }
  )
  .refine(
    (data) => {
      if (!data.startDate && data.endDate) return false;

      return true;
    },
    {
      message: '조회기간 시작일을 선택해주세요',
      path: ['startDate'],
    }
  );

export type RegionalInvoiceFilter = z.infer<typeof regionalInvoiceFilterSchema>;
