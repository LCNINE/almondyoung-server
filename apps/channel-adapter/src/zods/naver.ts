import { z } from 'zod';

// 개별 발송 처리 객체에 대한 스키마
export const NaverDispatchItemSchema = z.object({
  productOrderId: z.string().min(1, 'productOrderId는 필수입니다.'),
  deliveryMethod: z.string().min(1, 'deliveryMethod는 필수입니다.'),
  deliveryCompanyCode: z.string().min(1, 'deliveryCompanyCode는 필수입니다.'),
  trackingNumber: z.string().min(1, 'trackingNumber는 필수입니다.'),
  dispatchDate: z
    .string()
    .datetime('dispatchDate는 ISO 8601 날짜 형식이어야 합니다.'),
});

// 최종 API 요청 본문 스키마
export const NaverDispatchRequestSchema = z.object({
  dispatchProductOrders: z
    .array(NaverDispatchItemSchema)
    .min(1, '발송할 주문이 최소 1건 이상이어야 합니다.'),
});

// Zod 스키마로부터 TypeScript 타입 자동 생성
export type NaverDispatchItem = z.infer<typeof NaverDispatchItemSchema>;
export type NaverDispatchRequest = z.infer<typeof NaverDispatchRequestSchema>;
