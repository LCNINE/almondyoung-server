import { z } from 'zod';
import { createCoupangApiResponseSchema, CurrencySchema, CoupangDeliveryCompanyCodeSchema } from './coupang-common.zod';

/**
 * 쿠팡 반품/취소 관련 Zod 스키마
 *
 * 반품 요청 조회, 반품 처리, 출고중지, 회수송장 등 반품 도메인 스키마를 정의합니다.
 *
 * @author Channel Adapter Team
 * @version 2.0.0
 */

// =================================================================
// == 반품 아이템 스키마 (Return Item)
// =================================================================

export const CoupangReturnItemSchema = z.object({
  vendorItemId: z.number(), // 옵션 ID
  vendorItemName: z.string(), // 옵션명
  cancelCount: z.number(), // 취소(반품) 수량
  purchaseCount: z.number(), // 주문 수량
  shipmentBoxId: z.number(), // 원배송번호
  sellerProductId: z.number(), // 업체등록상품번호
  sellerProductName: z.string(), // 업체등록상품명
});

export const CoupangReturnReceiptSchema = z.object({
  receiptId: z.number(), // 취소(반품) 접수번호
  orderId: z.number(), // 주문번호
  receiptType: z.enum(['RETURN', 'CANCEL']), // 클레임 유형
  receiptStatus: z.string(), // 취소(반품) 진행 상태
  createdAt: z.iso.datetime(), // 접수 시간
  faultByType: z.string(), // 귀책 타입
  returnItems: z.array(CoupangReturnItemSchema), // 반품 아이템 목록
  reasonCode: z.string().optional(), // 반품 사유 코드
  reasonCodeText: z.string().optional(), // 반품 사유 설명
});

// =================================================================
// == 반품 목록 조회 스키마 (Get Return Requests)
// =================================================================

export const GetReturnRequestsParamsSchema = z
  .object({
    searchType: z.literal('timeFrame').optional().describe("searchType은 'timeFrame' 값만 가능합니다."),

    createdAtFrom: z
      .string()
      .optional()
      .refine((val) => !val || typeof val === 'string', 'createdAtFrom은 문자열이어야 합니다.'),

    createdAtTo: z
      .string()
      .optional()
      .refine((val) => !val || typeof val === 'string', 'createdAtTo는 문자열이어야 합니다.'),

    status: z.enum(['RU', 'UC', 'CC', 'PR']).optional().describe("status는 'RU', 'UC', 'CC', 'PR' 중 하나여야 합니다."),

    cancelType: z
      .enum(['RETURN', 'CANCEL'])
      .optional()
      .default('RETURN')
      .describe("cancelType은 'RETURN', 'CANCEL' 중 하나여야 합니다."),

    nextToken: z.string().optional(),

    maxPerPage: z
      .number()
      .int()
      .optional()
      .default(50)
      .refine((val) => val === undefined || Number.isInteger(val), 'maxPerPage는 숫자여야 합니다.'),

    orderId: z
      .number()
      .int()
      .optional()
      .refine((val) => val === undefined || Number.isInteger(val), 'orderId는 숫자여야 합니다.'),
  })
  .superRefine((data, ctx) => {
    // --- 교차 필드 검증 ---

    // 1️⃣ cancelType이 'CANCEL'일 경우 status 금지
    if (data.cancelType === 'CANCEL' && data.status) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "cancelType이 'CANCEL'일 경우 status 파라미터는 사용할 수 없습니다.",
        path: ['status'],
      });
    }

    // 2️⃣ status가 없을 경우 orderId 필수
    if (!data.status && !data.orderId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'status 파라미터를 사용하지 않을 경우, orderId는 필수입니다.',
        path: ['orderId'],
      });
    }

    // 3️⃣ searchType이 'timeFrame'일 경우 특정 필드 금지
    if (data.searchType === 'timeFrame') {
      if (data.nextToken || (data.maxPerPage && data.maxPerPage !== 50) || data.orderId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "searchType이 'timeFrame'일 경우 nextToken, maxPerPage, orderId는 지원하지 않습니다.",
          path: ['searchType'],
        });
      }
    }

    // 4️⃣ createdAtFrom / createdAtTo 형식 검증
    const timeFrameFormat = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
    const dateOnlyFormat = /^\d{4}-\d{2}-\d{2}$/;

    if (data.createdAtFrom) {
      const isValid =
        data.searchType === 'timeFrame'
          ? timeFrameFormat.test(data.createdAtFrom)
          : dateOnlyFormat.test(data.createdAtFrom);
      if (!isValid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'createdAtFrom의 날짜 형식이 searchType과 일치하지 않습니다.',
          path: ['createdAtFrom'],
        });
      }
    }

    if (data.createdAtTo) {
      const isValid =
        data.searchType === 'timeFrame'
          ? timeFrameFormat.test(data.createdAtTo)
          : dateOnlyFormat.test(data.createdAtTo);
      if (!isValid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'createdAtTo의 날짜 형식이 searchType과 일치하지 않습니다.',
          path: ['createdAtTo'],
        });
      }
    }
  });
export const GetReturnRequestsResponseSchema = createCoupangApiResponseSchema(
  z.array(CoupangReturnReceiptSchema),
).extend({
  nextToken: z.string().optional(), // 다음 페이지 토큰
});

// =================================================================
// == 반품 단건 조회 스키마 (Get Single Return Request)
// =================================================================

export const SingleReturnItemSchema = CoupangReturnItemSchema.extend({
  releaseStatus: z.string(), // 상품출고여부 (Y, N, S, A)
  cancelCompleteUser: z.string(), // 주문취소처리 담당자
});

export const ReturnDeliveryDtoSchema = z.object({
  deliveryCompanyCode: z.string(), // 회수 택배사코드
  deliveryInvoiceNo: z.string(), // 회수 운송장번호
});

export const CoupangSingleReturnRequestSchema = z.object({
  receiptId: z.number(), // 취소(반품)접수번호
  orderId: z.number(), // 주문번호
  paymentId: z.number(), // 결제번호
  receiptType: z.enum(['RETURN', 'CANCEL']), // 취소유형
  receiptStatus: z.string(), // 취소(반품)진행 상태
  createdAt: z.string(), // 취소(반품) 접수시간
  modifiedAt: z.string(), // 취소(반품) 상태 최종 변경시간
  requesterName: z.string(), // 반품 신청인 이름
  requesterPhoneNumber: z.string(), // 반품 신청인 전화번호
  requesterRealPhoneNumber: z.string().nullable(), // 반품 신청인 실전화번호
  requesterAddress: z.string(), // 반품 회수지 주소
  requesterAddressDetail: z.string(), // 반품 회수지 상세주소
  requesterZipCode: z.string(), // 반품 회수지 우편번호
  cancelReasonCategory1: z.string(), // 반품 사유 카테고리 1
  cancelReasonCategory2: z.string(), // 반품 사유 카테고리 2
  cancelReason: z.string(), // 취소사유 상세내역
  cancelCountSum: z.number(), // 총 취소수량
  returnDeliveryId: z.number(), // 반품배송번호
  returnDeliveryType: z.string(), // 회수종류
  releaseStopStatus: z.string(), // 출고중지처리상태
  enclosePrice: CurrencySchema, // 동봉배송비
  faultByType: z.string(), // 귀책타입
  preRefund: z.boolean(), // 빠른환불 여부
  completeConfirmType: z.string(), // 완료 확인 종류
  completeConfirmDate: z.string(), // yyyy-MM-ddTHH:mm:ss 완료 확인 시간
  returnItems: z.array(SingleReturnItemSchema), // 반품 아이템 목록
  returnDeliveryDtos: z.array(ReturnDeliveryDtoSchema), // 회수 운송장 정보
  reasonCode: z.string(), // 반품사유코드
  reasonCodeText: z.string(), // 반품사유설명
  returnShippingCharge: CurrencySchema, // 예상 반품배송비
});

export const GetSingleReturnRequestResponseSchema = createCoupangApiResponseSchema(CoupangSingleReturnRequestSchema);

// =================================================================
// == 출고중지 처리 스키마 (Stopped Shipment)
// =================================================================

export const CoupangStoppedShipmentRequestSchema = z.object({
  vendorId: z.string().min(1), // 판매자 ID
  receiptId: z.number().int().positive(), // 접수번호
  cancelCount: z.number().int().positive(), // 취소 수량
});

export const CoupangStoppedShipmentResponseSchema = createCoupangApiResponseSchema(
  z.object({
    resultCode: z.enum(['SUCCESS', 'FAIL']),
    resultMessage: z.string(),
  }),
);

// =================================================================
// == 이미출고 처리 스키마 (Completed Shipment)
// =================================================================

export const CoupangCompletedShipmentRequestSchema = z.object({
  vendorId: z.string().min(1), // 판매자 ID
  receiptId: z.number().int().positive(), // 접수번호
  deliveryCompanyCode: z.string().min(1), // 택배사 코드
  invoiceNumber: z.string().min(1), // 송장번호
});

export const CoupangCompletedShipmentResponseSchema = createCoupangApiResponseSchema(
  z.object({
    resultCode: z.enum(['SUCCESS', 'FAIL']),
    resultMessage: z.string(),
  }),
);

// =================================================================
// == 반품상품 입고확인 스키마 (Confirm Return Receipt)
// =================================================================

export const CoupangConfirmReturnReceiptRequestSchema = z.object({
  vendorId: z.string().min(1), // 판매자 ID
  receiptId: z.number().int().positive(), // 접수번호
});

export const CoupangConfirmReturnReceiptResponseSchema = createCoupangApiResponseSchema(
  z.object({
    resultCode: z.enum(['SUCCESS', 'FAIL']),
    resultMessage: z.string(),
  }),
);

// =================================================================
// == 반품요청 승인 스키마 (Approve Return Request)
// =================================================================

export const CoupangApproveReturnRequestSchema = z.object({
  vendorId: z.string().min(1), // 판매자 ID
  receiptId: z.number().int().positive(), // 접수번호
  cancelCount: z.number().int().positive(), // 반품접수수량
});

export const CoupangApproveReturnResponseSchema = z.object({
  code: z.string(), // 성공 시 "200"
  message: z.string(),
});

// =================================================================
// == 반품 철회 이력 조회 스키마 (Return Withdrawal History)
// =================================================================

export const GetReturnWithdrawalHistoryParamsSchema = z
  .object({
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
      message: 'dateFrom은 yyyy-MM-dd 형식이어야 합니다.',
    }),
    dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
      message: 'dateTo는 yyyy-MM-dd 형식이어야 합니다.',
    }),
    pageIndex: z.number().int().positive().optional().default(1),
    sizePerPage: z.number().int().positive().max(100).optional().default(10),
  })
  .refine(
    (data) => {
      const from = new Date(data.dateFrom);
      const to = new Date(data.dateTo);
      const diffTime = Math.abs(to.getTime() - from.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // 시작일과 종료일 포함
      return diffDays <= 7;
    },
    {
      message: '최대 조회 기간은 7일입니다.',
      path: ['dateTo'],
    },
  );

export const CoupangReturnWithdrawalItemSchema = z.object({
  cancelId: z.number(),
  orderId: z.number(),
  vendorId: z.string(),
  refundDeliveryDuty: z.enum(['COM', 'CUS', 'COU']),
  createdAt: z.string(),
  vendorItemIds: z.array(z.number()),
});

export const GetReturnWithdrawalHistoryResponseSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z.array(CoupangReturnWithdrawalItemSchema),
  nextPageIndex: z.string(), // 마지막 페이지일 경우 빈 값("")
});

export const GetReturnWithdrawalHistoryByIdsRequestSchema = z.object({
  cancelIds: z
    .array(z.number().int().positive())
    .min(1, { message: 'cancelIds는 최소 1개 이상이어야 합니다.' })
    .max(50, { message: 'cancelIds는 최대 50개까지 조회 가능합니다.' }),
});

export const GetReturnWithdrawalHistoryByIdsResponseSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z.array(CoupangReturnWithdrawalItemSchema),
});

// =================================================================
// == 회수송장 등록 스키마 (Register Return Invoice)
// =================================================================

export const CoupangRegisterReturnInvoiceRequestSchema = z.object({
  returnExchangeDeliveryType: z.enum(['RETURN', 'EXCHANGE']),
  receiptId: z.number().int().positive(),
  deliveryCompanyCode: CoupangDeliveryCompanyCodeSchema,
  invoiceNumber: z.string().min(1),
  regNumber: z.string().optional(), // 택배사 회수번호 (선택)
});

export const CoupangRegisterReturnInvoiceDataSchema = z.object({
  deliveryCompanyCode: z.string(),
  invoiceNumber: z.string(),
  invoiceNumberId: z.number(),
  receiptId: z.number(),
  regNumber: z.string(),
  returnDeliveryId: z.number(),
  returnExchangeDeliveryType: z.enum(['RETURN', 'EXCHANGE']),
});

export const CoupangRegisterReturnInvoiceResponseSchema = createCoupangApiResponseSchema(
  CoupangRegisterReturnInvoiceDataSchema,
);

// =================================================================
// == 타입 추출 (Type Exports)
// =================================================================

export type CoupangReturnItem = z.infer<typeof CoupangReturnItemSchema>;
export type CoupangReturnReceipt = z.infer<typeof CoupangReturnReceiptSchema>;
export type GetReturnRequestsParams = z.infer<typeof GetReturnRequestsParamsSchema>;
export type GetReturnRequestsResponse = z.infer<typeof GetReturnRequestsResponseSchema>;

export type SingleReturnItem = z.infer<typeof SingleReturnItemSchema>;
export type ReturnDeliveryDto = z.infer<typeof ReturnDeliveryDtoSchema>;
export type CoupangSingleReturnRequest = z.infer<typeof CoupangSingleReturnRequestSchema>;
export type GetSingleReturnRequestResponse = z.infer<typeof GetSingleReturnRequestResponseSchema>;

export type CoupangStoppedShipmentRequest = z.infer<typeof CoupangStoppedShipmentRequestSchema>;
export type CoupangStoppedShipmentResponse = z.infer<typeof CoupangStoppedShipmentResponseSchema>;
export type CoupangCompletedShipmentRequest = z.infer<typeof CoupangCompletedShipmentRequestSchema>;
export type CoupangCompletedShipmentResponse = z.infer<typeof CoupangCompletedShipmentResponseSchema>;

export type CoupangConfirmReturnReceiptRequest = z.infer<typeof CoupangConfirmReturnReceiptRequestSchema>;
export type CoupangConfirmReturnReceiptResponse = z.infer<typeof CoupangConfirmReturnReceiptResponseSchema>;

export type CoupangApproveReturnRequest = z.infer<typeof CoupangApproveReturnRequestSchema>;
export type CoupangApproveReturnResponse = z.infer<typeof CoupangApproveReturnResponseSchema>;

export type GetReturnWithdrawalHistoryParams = z.infer<typeof GetReturnWithdrawalHistoryParamsSchema>;
export type CoupangReturnWithdrawalItem = z.infer<typeof CoupangReturnWithdrawalItemSchema>;
export type GetReturnWithdrawalHistoryResponse = z.infer<typeof GetReturnWithdrawalHistoryResponseSchema>;

export type GetReturnWithdrawalHistoryByIdsRequest = z.infer<typeof GetReturnWithdrawalHistoryByIdsRequestSchema>;
export type GetReturnWithdrawalHistoryByIdsResponse = z.infer<typeof GetReturnWithdrawalHistoryByIdsResponseSchema>;

export type CoupangRegisterReturnInvoiceRequest = z.infer<typeof CoupangRegisterReturnInvoiceRequestSchema>;
export type CoupangRegisterReturnInvoiceResponse = z.infer<typeof CoupangRegisterReturnInvoiceResponseSchema>;
