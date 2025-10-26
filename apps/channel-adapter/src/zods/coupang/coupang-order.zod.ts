import { z } from 'zod';
import {
  createCoupangApiResponseSchema,
  CurrencySchema,
  CoupangDeliveryCompanyCodeSchema,
  CoupangOrderStatusSchema,
  OrdererSchema,
  ReceiverSchema,
} from './coupang-common.zod';

/**
 * 쿠팡 주문/발주서 관련 Zod 스키마
 *
 * 주문 조회, 송장 처리, 배송 히스토리 등 주문 도메인 스키마를 정의합니다.
 *
 * @author Channel Adapter Team
 * @version 2.0.0
 */

// =================================================================
// == 주문 상품 스키마 (Order Item)
// =================================================================

export const OrderItemSchema = z.object({
  vendorItemId: z.number(), // 옵션 ID
  vendorItemName: z.string(), // 노출상품명
  shippingCount: z.number().int().min(0), // 주문 수량
  salesPrice: CurrencySchema, // 개당 상품 가격
  orderPrice: CurrencySchema, // 결제 가격
  discountPrice: CurrencySchema, // 총 할인 가격
  sellerProductId: z.number(), // 등록상품 ID
  sellerProductName: z.string(), // 등록상품명
  cancelCount: z.number().int().min(0).default(0), // 취소수량
  holdCountForCancel: z.number().int().min(0).default(0), // 환불대기수량
  invoiceNumberUploadDate: z.string().optional(), // 운송장번호 업로드 일시
  canceled: z.boolean().default(false), // 주문 취소 여부
});

// =================================================================
// == 발주서 스키마 (Order Sheet)
// =================================================================

export const CoupangOrderSheetSchema = z.object({
  shipmentBoxId: z.number(), // 배송번호 (묶음배송번호)
  orderId: z.number(), // 주문번호
  orderedAt: z.iso.datetime(), // 주문일시
  paidAt: z.iso.datetime(), // 결제일시
  status: CoupangOrderStatusSchema, // 발주서 상태
  orderer: OrdererSchema, // 주문자 정보
  receiver: ReceiverSchema, // 수취인 정보
  orderItems: z.array(OrderItemSchema), // 주문 상품 목록
  deliveryCompanyName: z.string().optional(), // 택배사
  invoiceNumber: z.string().optional(), // 운송장번호
  inTrasitDateTime: z.iso.datetime().optional(), // 출고일(발송일)
  deliveredDate: z.iso.datetime().optional(), // 배송완료일
});

export const CoupangOrderSheetListResponseSchema = z.object({
  code: z.number().int(), // 서버 응답 코드
  message: z.string(), // 서버 응답 메시지
  data: z.array(CoupangOrderSheetSchema), // 발주서 목록
  nextToken: z.string().optional(), // 다음 페이지 토큰
});

export const CoupangSingleOrderSheetResponseSchema =
  createCoupangApiResponseSchema(CoupangOrderSheetSchema);

export const CoupangOrderSheetByOrderIdResponseSchema =
  createCoupangApiResponseSchema(z.array(CoupangOrderSheetSchema));

// =================================================================
// == 상품준비중 처리 스키마 (Acknowledge Order Sheets)
// =================================================================

export const CoupangAcknowledgeOrdersheetsRequestSchema = z.object({
  vendorId: z.string().regex(/^A\d{8}$/), // 판매자 ID
  shipmentBoxIds: z.array(z.string()).min(1).max(50), // 배송번호 목록 (최대 50개)
});

export const CoupangAcknowledgeOrdersheetsResponseSchema =
  createCoupangApiResponseSchema(
    z.object({
      responseCode: z.number(), // 전체 처리 결과 코드
      responseList: z.array(
        z.object({
          shipmentBoxId: z.number(),
          succeed: z.boolean(),
          resultCode: z.string(),
          resultMessage: z.string(),
        }),
      ),
    }),
  );

// =================================================================
// == 송장 업로드 스키마 (Upload Invoice)
// =================================================================

export const OrderSheetInvoiceApplyDtoSchema = z.object({
  shipmentBoxId: z.number().int().positive(), // 배송번호
  orderId: z.number().int().positive(), // 주문번호
  vendorItemId: z.number().int().positive(), // 옵션 ID
  deliveryCompanyCode: CoupangDeliveryCompanyCodeSchema, // 택배사 코드
  invoiceNumber: z.string().max(50).optional(), // 송장 번호
  splitShipping: z.boolean(), // 분리배송 여부
  preSplitShipped: z.boolean(), // 선분리배송 여부
});

export const CoupangUploadInvoiceRequestSchema = z.object({
  vendorId: z.string().regex(/^A\d{8}$/), // 판매자 ID
  orderSheetInvoiceApplyDtos: z
    .array(OrderSheetInvoiceApplyDtoSchema)
    .min(1)
    .max(100), // 송장 업로드 대상 목록 (최대 100개)
});

export const CoupangUploadInvoiceResponseSchema =
  createCoupangApiResponseSchema(
    z.object({
      responseCode: z.number(), // 전체 처리 결과 코드
      responseList: z.array(
        z.object({
          shipmentBoxId: z.number(),
          succeed: z.boolean(),
          resultCode: z.string(),
          resultMessage: z.string(),
        }),
      ),
    }),
  );

// =================================================================
// == 송장 업데이트 스키마 (Update Invoice)
// =================================================================

export const OrderSheetUpdateInvoiceDtoSchema =
  OrderSheetInvoiceApplyDtoSchema.omit({
    splitShipping: true,
    preSplitShipped: true,
  }).extend({
    splitShipping: z.union([z.boolean(), z.string()]), // "False"/"True"도 가능
    preSplitShipped: z.union([z.boolean(), z.string()]),
  });

export const CoupangUpdateInvoiceRequestSchema = z.object({
  vendorId: z.string().min(1), // 판매자 ID
  orderSheetInvoiceApplyDtos: z.array(OrderSheetUpdateInvoiceDtoSchema).min(1), // 송장 업데이트 대상 목록
});

export const CoupangUpdateInvoiceResponseSchema =
  createCoupangApiResponseSchema(
    z.object({
      responseCode: z.number(), // 전체 처리 결과 코드
      responseList: z.array(
        z.object({
          shipmentBoxId: z.number(),
          succeed: z.boolean(),
          resultCode: z.string(),
          resultMessage: z.string(),
          retryRequired: z.boolean(),
        }),
      ),
    }),
  );

// =================================================================
// == 배송 히스토리 스키마 (Delivery History)
// =================================================================

export const CoupangDeliveryHistoryRequestSchema = z.object({
  vendorId: z.string(), // 판매자 ID
  shipmentBoxId: z.number(), // 발주서 ID
});

export const CoupangDeliveryHistoryItemSchema = z.object({
  shipmentBoxId: z.number(), // 발주서 ID
  status: z.string(), // 배송상태
  statusName: z.string(), // 배송상태명
  changedAt: z.string(), // 상태 변경 일시
});

export const CoupangDeliveryHistoryResponseSchema =
  createCoupangApiResponseSchema(
    z.object({
      shipmentBoxId: z.number(), // 발주서 ID
      histories: z.array(CoupangDeliveryHistoryItemSchema), // 히스토리 목록
    }),
  );

// =================================================================
// == 타입 추출 (Type Exports)
// =================================================================

export type OrderItem = z.infer<typeof OrderItemSchema>;
export type CoupangOrderSheet = z.infer<typeof CoupangOrderSheetSchema>;
export type CoupangOrderSheetListResponse = z.infer<
  typeof CoupangOrderSheetListResponseSchema
>;
export type CoupangSingleOrderSheetResponse = z.infer<
  typeof CoupangSingleOrderSheetResponseSchema
>;
export type CoupangOrderSheetByOrderIdResponse = z.infer<
  typeof CoupangOrderSheetByOrderIdResponseSchema
>;

export type CoupangAcknowledgeOrdersheetsRequest = z.infer<
  typeof CoupangAcknowledgeOrdersheetsRequestSchema
>;
export type CoupangAcknowledgeOrdersheetsResponse = z.infer<
  typeof CoupangAcknowledgeOrdersheetsResponseSchema
>;

export type OrderSheetInvoiceApplyDto = z.infer<
  typeof OrderSheetInvoiceApplyDtoSchema
>;
export type CoupangUploadInvoiceRequest = z.infer<
  typeof CoupangUploadInvoiceRequestSchema
>;
export type CoupangUploadInvoiceResponse = z.infer<
  typeof CoupangUploadInvoiceResponseSchema
>;

export type OrderSheetUpdateInvoiceDto = z.infer<
  typeof OrderSheetUpdateInvoiceDtoSchema
>;
export type CoupangUpdateInvoiceRequest = z.infer<
  typeof CoupangUpdateInvoiceRequestSchema
>;
export type CoupangUpdateInvoiceResponse = z.infer<
  typeof CoupangUpdateInvoiceResponseSchema
>;

export type CoupangDeliveryHistoryRequest = z.infer<
  typeof CoupangDeliveryHistoryRequestSchema
>;
export type CoupangDeliveryHistoryItem = z.infer<
  typeof CoupangDeliveryHistoryItemSchema
>;
export type CoupangDeliveryHistoryResponse = z.infer<
  typeof CoupangDeliveryHistoryResponseSchema
>;
