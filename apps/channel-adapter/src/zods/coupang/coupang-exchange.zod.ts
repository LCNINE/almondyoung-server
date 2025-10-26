import { z } from 'zod';
import { CoupangDeliveryCompanyCodeSchema } from './coupang-common.zod';

/**
 * 쿠팡 교환 관련 Zod 스키마
 *
 * 교환 요청 조회, 교환 처리, 송장 업로드 등 교환 도메인 스키마를 정의합니다.
 *
 * @author Channel Adapter Team
 * @version 2.0.0
 */

// =================================================================
// == 교환요청 목록 조회 스키마 (Get Exchange Requests)
// =================================================================

export const GetExchangeRequestsParamsSchema = z
  .object({
    createdAtFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?$/, {
        message:
          'createdAtFrom은 yyyy-MM-dd 또는 yyyy-MM-ddTHH:mm:ss 형식이어야 합니다.',
      })
      // 필요하면 transform 제거
      .transform((val) => val),
    createdAtTo: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?$/, {
        message:
          'createdAtTo는 yyyy-MM-dd 또는 yyyy-MM-ddTHH:mm:ss 형식이어야 합니다.',
      })
      .transform((val) => val),
    status: z
      .enum(['RECEIPT', 'PROGRESS', 'SUCCESS', 'REJECT', 'CANCEL'])
      .optional(),
    orderId: z
      .union([z.string().regex(/^\d+$/).transform(Number), z.number()])
      .optional(),
    nextToken: z.string().optional(),
    maxPerPage: z
      .union([z.number(), z.string().transform(Number)])
      .pipe(z.number().int().positive())
      .optional()
      .default(10),
  })
  .refine(
    (data) => {
      const from = new Date(data.createdAtFrom);
      const to = new Date(data.createdAtTo);
      const diffTime = Math.abs(to.getTime() - from.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return diffDays <= 7;
    },
    {
      message: '최대 조회 기간은 7일입니다.',
      path: ['createdAtTo'],
    },
  );

// --- 교환요청 응답을 위한 중첩 스키마들 ---

export const ExchangeAddressDtoSchema = z.object({
  exchangeAddressId: z.number(),
  returnCustomerName: z.string(),
  returnAddressZipCode: z.string(),
  returnAddress: z.string(),
  returnAddressDetail: z.string(),
  returnPhone: z.string(),
  returnMobile: z.string(),
  returnMemo: z.string(),
  deliveryCustomerName: z.string(),
  deliveryAddressZipCode: z.string(),
  deliveryAddress: z.string(),
  deliveryAddressDetail: z.string(),
  deliveryPhone: z.string(),
  deliveryMobile: z.string(),
  deliveryMemo: z.string(),
  createdAt: z.string(),
  modifiedAt: z.string(),
});

export const InvoiceVendorItemDtoSchema = z.object({
  vendorItemId: z.number(),
  quantity: z.number(),
  hasAdditionalItem: z.boolean(),
  promiseDeliveryDate: z.string(),
  estimatedShippingDate: z.string(),
});

export const DeliveryInvoiceDtoSchema = z.object({
  invoiceNumber: z.string(),
  estimatedDeliveryDate: z.string(),
  deliveredDate: z.string(),
  statusModifiedAt: z.string(),
  invoiceNumberUploadDate: z.string(),
  statusCode: z.string(),
  deliverCode: z.string(),
  isMainShipmentInvoice: z.boolean(),
  parcelType: z.string(),
  invoiceVendorItemDtos: z.array(InvoiceVendorItemDtoSchema),
});

export const DeliveryInvoiceGroupDtoSchema = z.object({
  shipmentBoxId: z.number(),
  boxPrice: z.number(),
  orderId: z.number(),
  orderType: z.string(),
  customerType: z.string(),
  bundleType: z.string(),
  extraMessage: z.string(),
  shippingDeliveryType: z.string(),
  deliveryInvoiceDtos: z.array(DeliveryInvoiceDtoSchema),
});

export const ReturnDeliveryItemDtoSchema = z.object({
  vendorItemId: z.number(),
  statusCode: z.string(),
  returnCount: z.number(),
  releaseStatus: z.string(),
  paymentReturnDeliveryMapId: z.number(),
  paymentItemId: z.number(),
  modifiedBy: z.string(),
  modifiedAt: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
  count: z.number(),
  confirmType: z.string(),
  collectStatus: z.string(),
});

export const ReturnDeliveryDestinationDtoSchema = z.object({
  vendorZipCode: z.string(),
  vendorPhone: z.string(),
  vendorName: z.string(),
  vendorMobile: z.string(),
  vendorAddressDetail: z.string(),
  vendorAddress: z.string(),
  safetyNumberStatus: z.string(),
  safetyNumberId: z.number(),
  safetyNumber: z.string(),
  returnDeliveryId: z.number(),
  returnCenterCode: z.string(),
  receiptId: z.number(),
  orderedByMobile: z.string(),
  orderId: z.number(),
  message: z.string(),
  customerZipCode: z.string(),
  customerPhone: z.string(),
  customerName: z.string(),
  customerMobile: z.string(),
  customerAddressDetail: z.string(),
  customerAddress: z.string(),
});

export const ReturnDeliveryDtoForExchangeSchema = z.object({
  deliveryCompanyCode: z.string(),
  deliveryInvoiceNo: z.string(),
});

export const CollectInformationsDtoSchema = z.object({
  returnType: z.string(),
  expectedReturnDate: z.string(),
  returndeliveryItemDtos: z.array(ReturnDeliveryItemDtoSchema),
  returndeliveryDestinationDto: ReturnDeliveryDestinationDtoSchema,
  returnDeliveryDtos: ReturnDeliveryDtoForExchangeSchema,
});

export const ExchangeItemDtoSchema = z.object({
  exchangeItemId: z.number(),
  orderItemId: z.number(),
  orderItemUnitPrice: z.number(),
  orderItemName: z.string(),
  orderPackageId: z.number(),
  orderPackageName: z.string(),
  targetItemId: z.number(),
  targetItemUnitPrice: z.number(),
  targetItemName: z.string(),
  targetPackageId: z.number(),
  targetPackageName: z.string(),
  quantity: z.number(),
  orderItemDeliveryComplete: z.boolean(),
  orderItemReturnComplete: z.boolean(),
  targetItemDeliveryComplete: z.boolean(),
  createdAt: z.string(),
  modifiedAt: z.string(),
  originalShipmentBoxId: z.number(),
});

// --- 교환요청 목록의 각 아이템에 대한 메인 스키마 ---
export const CoupangExchangeRequestSchema = z.object({
  exchangeId: z.number(),
  orderId: z.number(),
  vendorId: z.string(),
  orderDeliveryStatusCode: z.string(),
  exchangeStatus: z.string(),
  referType: z.string(),
  faultType: z.string(),
  exchangeAmount: z.string(),
  reason: z.string().nullable(),
  reasonCode: z.string(),
  reasonCodeText: z.string(),
  reasonEtcDetail: z.string(),
  cancelReason: z.string(),
  createdByType: z.string(),
  createdAt: z.string(),
  modifiedByType: z.string(),
  modifiedAt: z.string(),
  exchangeItemDtoV1s: z.array(ExchangeItemDtoSchema),
  exchangeAddressDtoV1: ExchangeAddressDtoSchema,
  deliveryInvoiceGroupDtos: z.array(DeliveryInvoiceGroupDtoSchema),
  deliveryStatus: z.string(),
  collectStatus: z.string(),
  collectCompleteDate: z.string(),
  collectInformationsDto: CollectInformationsDtoSchema,
  successable: z.boolean(),
  orderDeliveryStatusLabel: z.string(),
  exchangeStatusLabel: z.string(),
  referTypeLabel: z.string(),
  faultTypeLabel: z.string(),
  createdByTypeLabel: z.string(),
  rejectable: z.boolean(),
  modifiedByTypeLabel: z.string(),
  deliveryInvoiceModifiable: z.boolean(),
});

// --- 최종 API 응답 스키마 ---
export const GetExchangeRequestsResponseSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z.array(CoupangExchangeRequestSchema),
  nextToken: z.string().optional(),
});

// =================================================================
// == 교환요청 상품 입고확인 처리 스키마
// =================================================================
export const CoupangConfirmExchangeReceiptRequestSchema = z.object({
  exchangeId: z.number().int().positive(),
  vendorId: z.string().min(1),
});

export const CoupangConfirmExchangeReceiptResponseSchema = z.object({
  code: z.string(), // "200"
  message: z.string(), // "SUCCESS"
});

// =================================================================
// == 교환요청 거부 처리 스키마
// =================================================================
export const CoupangRejectExchangeRequestSchema = z.object({
  // API 예시에는 string으로 되어 있어 union 타입으로 처리
  exchangeId: z.union([z.number().int().positive(), z.string()]),
  vendorId: z.string().min(1),
  exchangeRejectCode: z.enum(['SOLDOUT', 'WITHDRAW']),
});

export const CoupangRejectExchangeResponseSchema = z.object({
  code: z.string(), // "200"
  message: z.string(), // "SUCCESS"
  data: z.object({
    resultCode: z.string(), // "SUCCESS" or "FAIL"
    resultMessage: z.string(),
  }),
});

// =================================================================
// == 교환상품 송장 업로드 처리 스키마
// =================================================================
export const CoupangUploadExchangeInvoiceItemSchema = z.object({
  // API 예시에는 string으로 되어 있어 union 타입으로 처리
  exchangeId: z.union([z.number().int().positive(), z.string()]),
  vendorId: z.string().min(1),
  shipmentBoxId: z.union([z.number().int().positive(), z.string()]),
  goodsDeliveryCode: CoupangDeliveryCompanyCodeSchema,
  invoiceNumber: z.string().min(1),
});

// 요청 Body가 배열 형태임
export const CoupangUploadExchangeInvoiceRequestSchema = z.array(
  CoupangUploadExchangeInvoiceItemSchema,
);

export const CoupangUploadExchangeInvoiceResponseSchema = z.object({
  code: z.string(), // "200"
  message: z.string(), // "SUCCESS"
  data: z.object({
    resultCode: z.string(), // "SUCCESS" or "FAIL"
    resultMessage: z.string(),
  }),
});

// =================================================================
// == 타입 추출 (Type Exports)
// =================================================================

export type GetExchangeRequestsParams = z.infer<
  typeof GetExchangeRequestsParamsSchema
>;
export type CoupangExchangeRequest = z.infer<
  typeof CoupangExchangeRequestSchema
>;
export type GetExchangeRequestsResponse = z.infer<
  typeof GetExchangeRequestsResponseSchema
>;

export type CoupangConfirmExchangeReceiptRequest = z.infer<
  typeof CoupangConfirmExchangeReceiptRequestSchema
>;
export type CoupangConfirmExchangeReceiptResponse = z.infer<
  typeof CoupangConfirmExchangeReceiptResponseSchema
>;

export type CoupangRejectExchangeRequest = z.infer<
  typeof CoupangRejectExchangeRequestSchema
>;
export type CoupangRejectExchangeResponse = z.infer<
  typeof CoupangRejectExchangeResponseSchema
>;

export type CoupangUploadExchangeInvoiceRequest = z.infer<
  typeof CoupangUploadExchangeInvoiceRequestSchema
>;
export type CoupangUploadExchangeInvoiceResponse = z.infer<
  typeof CoupangUploadExchangeInvoiceResponseSchema
>;
