import { z } from 'zod';

/**
 * 쿠팡 API Zod 스키마 (완전판)
 *
 * 이 파일은 쿠팡 API와 관련된 모든 Zod 스키마와 타입을 관심사별로 그룹화하여 정의합니다.
 *
 * @author Channel Adapter Team
 * @version 1.3.0 (Single Return Request Added)
 */

// =================================================================
// == 1. 공통 타입, 헬퍼, 상수 (Common Types, Helpers, Constants)
// =================================================================

/**
 * 쿠팡 API 공통 응답 구조를 생성하는 제네릭 헬퍼 함수
 */
export function createCoupangApiResponseSchema<T extends z.ZodTypeAny>(
  dataSchema: T,
) {
  return z.object({
    code: z.number(), // e.g. 200
    message: z.string(), // e.g. "OK"
    data: dataSchema, // 실제 데이터
    nextToken: z.string().optional(), // 일부 API에서만 내려옴
  });
}

/**
 * 통화 정보 스키마 (ISO-4217 표준)
 */
export const CurrencySchema = z.object({
  currencyCode: z
    .string()
    .length(3)
    .regex(/^[A-Z]{3}$/), // 통화 코드 (e.g., "KRW")
  units: z.number().int(), // 통화 정수 부분 (e.g., 19000)
  nanos: z.number().int().min(-999999999).max(999999999), // 통화 소수점 부분
});

/**
 * 쿠팡에서 지원하는 택배사 코드
 */
export const CoupangDeliveryCompanyCodeSchema = z.enum([
  'CJGLS',
  'LOTTE',
  'HANJIN',
  'LOGEN',
  'EPOST',
  'KGB',
  'HYUNDAI',
  'DHL',
  'FEDEX',
  'UPS',
  'EMS',
  'KDEXP',
  'GOODTOLUCK',
  'DAELIM',
  'DONGGANG',
  'CHUNIL',
  'HONAM',
  'DAESIN',
  'ILYANG',
  'PANTOS',
  'FRESH',
  'CVSNET',
  'OTHER',
]);

/**
 * 쿠팡 발주서 상태
 */
export const CoupangOrderStatusSchema = z.enum([
  'ACCEPT',
  'INSTRUCT',
  'DEPARTURE',
  'DELIVERING',
  'FINAL_DELIVERY',
  'NONE_TRACKING',
]);
export const CoupangUpdateStockResponseSchema = z.object({
  code: z.enum(['SUCCESS', 'ERROR']),
  message: z.string(),
});

// == 상품/재고 관련 스키마 (Product/Stock)
// =================================================================
export const OrdererSchema = z.object({
  name: z.string(), // 주문자 이름
  safeNumber: z.string(), // 주문자 연락처 (안심번호)
  ordererNumber: z.string().nullable(), // 주문자 연락처 (실제번호)
});
// =================================================================
// == 2. 발주서/주문 관련 스키마 (Order Sheets / Orders)
// =================================================================
// =================================================================

export const ReceiverSchema = z.object({
  name: z.string(), // 수취인 이름
  safeNumber: z.string(), // 수취인 연락처 (안심번호)
  receiverNumber: z.string().nullable(), // 수취인 연락처 (실제번호)
  addr1: z.string(), // 수취인 배송지 주소
  addr2: z.string(), // 수취인 배송지 상세주소
  postCode: z.string(), // 수취인 우편번호
});

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
// == 3. 발송/송장 관련 스키마 (Dispatch / Invoice)
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
// == 4. 클레임 관련 스키마 (반품/취소) (Claims - Return/Cancel)
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
  createdAt: z.string().datetime(), // 접수 시간
  faultByType: z.string(), // 귀책 타입
  returnItems: z.array(CoupangReturnItemSchema), // 반품 아이템 목록
  reasonCode: z.string().optional(), // 반품 사유 코드
  reasonCodeText: z.string().optional(), // 반품 사유 설명
});
export const GetReturnRequestsParamsSchema = z
  .object({
    // --- 단일 필드 검증 (에러 메시지를 직접 지정) ---
    searchType: z
      .literal('timeFrame', {
        error: () => "searchType은 'timeFrame' 값만 가능합니다.",
      })
      .optional(),
    createdAtFrom: z
      .string({
        error: () => 'createdAtFrom은 문자열이어야 합니다.',
      })
      .optional(),

    createdAtTo: z
      .string({
        error: () => 'createdAtTo는 문자열이어야 합니다.',
      })
      .optional(),

    status: z
      .enum(['RU', 'UC', 'CC', 'PR'], {
        error: () => "status는 'RU', 'UC', 'CC', 'PR' 중 하나여야 합니다.",
      })
      .optional(),

    cancelType: z
      .enum(['RETURN', 'CANCEL'], {
        error: () => "cancelType은 'RETURN', 'CANCEL' 중 하나여야 합니다.",
      })
      .optional()
      .default('RETURN'),

    nextToken: z.string().optional(),

    maxPerPage: z
      .number({
        error: () => 'maxPerPage는 숫자여야 합니다.',
      })
      .int()
      .optional()
      .default(50),

    orderId: z
      .number({
        error: () => 'orderId는 숫자여야 합니다.',
      })
      .int()
      .optional(),
  })
  // --- 교차 필드 검증 (.refine 사용) ---
  .refine((data) => !(data.cancelType === 'CANCEL' && data.status), {
    message:
      "cancelType이 'CANCEL'일 경우 status 파라미터는 사용할 수 없습니다.",
    path: ['status'], // 에러가 발생한 필드를 지정
  })
  .refine((data) => !(!data.status && !data.orderId), {
    message: 'status 파라미터를 사용하지 않을 경우, orderId는 필수입니다.',
    path: ['orderId'],
  })
  .refine(
    (data) => {
      if (data.searchType === 'timeFrame') {
        return (
          !data.nextToken &&
          !(data.maxPerPage && data.maxPerPage !== 50) &&
          !data.orderId
        );
      }
      return true;
    },
    {
      message:
        "searchType이 'timeFrame'일 경우 nextToken, maxPerPage, orderId는 지원하지 않습니다.",
      path: ['searchType'],
    },
  )
  .refine(
    (data) => {
      if (data.createdAtFrom) {
        const format =
          data.searchType === 'timeFrame'
            ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
            : /^\d{4}-\d{2}-\d{2}$/;
        return format.test(data.createdAtFrom);
      }
      return true;
    },
    {
      message: 'createdAtFrom의 날짜 형식이 searchType과 일치하지 않습니다.',
      path: ['createdAtFrom'],
    },
  )
  .refine(
    (data) => {
      if (data.createdAtTo) {
        const format =
          data.searchType === 'timeFrame'
            ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
            : /^\d{4}-\d{2}-\d{2}$/;
        return format.test(data.createdAtTo);
      }
      return true;
    },
    {
      message: 'createdAtTo의 날짜 형식이 searchType과 일치하지 않습니다.',
      path: ['createdAtTo'],
    },
  );

export const CoupangConfirmReturnReceiptRequestSchema = z.object({
  vendorId: z.string().min(1), // 판매자 ID
  receiptId: z.number().int().positive(), // 접수번호
});

export const CoupangConfirmReturnReceiptResponseSchema =
  createCoupangApiResponseSchema(
    z.object({
      resultCode: z.enum(['SUCCESS', 'FAIL']),
      resultMessage: z.string(),
    }),
  );

// =================================================================
// == [추가] 반품요청 승인 처리 스키마
// =================================================================
export const CoupangApproveReturnRequestSchema = z.object({
  vendorId: z.string().min(1), // 판매자 ID
  receiptId: z.number().int().positive(), // 접수번호
  cancelCount: z.number().int().positive(), // 반품접수수량
});

// 이 API는 data 필드 없이 code, message만 반환합니다.
export const CoupangApproveReturnResponseSchema = z.object({
  code: z.string(), // 성공 시 "200"
  message: z.string(),
});

// =================================================================
// == [추가] 반품 철회 이력 조회 스키마
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

// =================================================================
// == [추가] 반품 철회 이력 접수번호로 조회 스키마
// =================================================================
export const GetReturnWithdrawalHistoryByIdsRequestSchema = z.object({
  cancelIds: z
    .array(z.number().int().positive())
    .min(1, { message: 'cancelIds는 최소 1개 이상이어야 합니다.' })
    .max(50, { message: 'cancelIds는 최대 50개까지 조회 가능합니다.' }),
});

// data 필드의 아이템은 기간별 조회와 동일하므로 CoupangReturnWithdrawalItemSchema를 재사용합니다.
export const GetReturnWithdrawalHistoryByIdsResponseSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z.array(CoupangReturnWithdrawalItemSchema),
});

// =================================================================
// == [추가] 회수송장 등록 스키마
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

export const CoupangRegisterReturnInvoiceResponseSchema =
  createCoupangApiResponseSchema(CoupangRegisterReturnInvoiceDataSchema);

export const GetReturnRequestsResponseSchema = createCoupangApiResponseSchema(
  z.array(CoupangReturnReceiptSchema),
).extend({
  nextToken: z.string().optional(), // 다음 페이지 토큰
});

// =================================================================
// == [추가] 반품요청 단건 조회 스키마
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

export const GetSingleReturnRequestResponseSchema =
  createCoupangApiResponseSchema(CoupangSingleReturnRequestSchema);
// =================================================================

export const CoupangStoppedShipmentRequestSchema = z.object({
  vendorId: z.string().min(1), // 판매자 ID
  receiptId: z.number().int().positive(), // 접수번호
  cancelCount: z.number().int().positive(), // 취소 수량
});

export const CoupangStoppedShipmentResponseSchema =
  createCoupangApiResponseSchema(
    z.object({
      resultCode: z.enum(['SUCCESS', 'FAIL']),
      resultMessage: z.string(),
    }),
  );

export const CoupangCompletedShipmentRequestSchema = z.object({
  vendorId: z.string().min(1), // 판매자 ID
  receiptId: z.number().int().positive(), // 접수번호
  deliveryCompanyCode: z.string().min(1), // 택배사 코드
  invoiceNumber: z.string().min(1), // 송장번호
});

export const CoupangCompletedShipmentResponseSchema =
  createCoupangApiResponseSchema(
    z.object({
      resultCode: z.enum(['SUCCESS', 'FAIL']),
      resultMessage: z.string(),
    }),
  );

// [추가] 반품상품 입고확인 처리 타입
export type CoupangConfirmReturnReceiptRequest = z.infer<
  typeof CoupangConfirmReturnReceiptRequestSchema
>;
export type CoupangConfirmReturnReceiptResponse = z.infer<
  typeof CoupangConfirmReturnReceiptResponseSchema
>;

// [추가] 반품요청 승인 처리 타입
export type CoupangApproveReturnRequest = z.infer<
  typeof CoupangApproveReturnRequestSchema
>;
export type CoupangApproveReturnResponse = z.infer<
  typeof CoupangApproveReturnResponseSchema
>;

// [추가] 반품 철회 이력 조회 타입
export type GetReturnWithdrawalHistoryParams = z.infer<
  typeof GetReturnWithdrawalHistoryParamsSchema
>;
export type CoupangReturnWithdrawalItem = z.infer<
  typeof CoupangReturnWithdrawalItemSchema
>;
export type GetReturnWithdrawalHistoryResponse = z.infer<
  typeof GetReturnWithdrawalHistoryResponseSchema
>;

// [추가] 반품 철회 이력 접수번호로 조회 타입
export type GetReturnWithdrawalHistoryByIdsRequest = z.infer<
  typeof GetReturnWithdrawalHistoryByIdsRequestSchema
>;
export type GetReturnWithdrawalHistoryByIdsResponse = z.infer<
  typeof GetReturnWithdrawalHistoryByIdsResponseSchema
>;

// [추가] 회수송장 등록 타입
export type CoupangRegisterReturnInvoiceRequest = z.infer<
  typeof CoupangRegisterReturnInvoiceRequestSchema
>;
export type CoupangRegisterReturnInvoiceResponse = z.infer<
  typeof CoupangRegisterReturnInvoiceResponseSchema
>;

// [추가] 교환요청 목록 조회 타입
export type GetExchangeRequestsParams = z.infer<
  typeof GetExchangeRequestsParamsSchema
>;
export type CoupangExchangeRequest = z.infer<
  typeof CoupangExchangeRequestSchema
>;
export type GetExchangeRequestsResponse = z.infer<
  typeof GetExchangeRequestsResponseSchema
>;

// [추가] 교환요청 상품 입고확인 처리 타입
export type CoupangConfirmExchangeReceiptRequest = z.infer<
  typeof CoupangConfirmExchangeReceiptRequestSchema
>;
export type CoupangConfirmExchangeReceiptResponse = z.infer<
  typeof CoupangConfirmExchangeReceiptResponseSchema
>;

// [추가] 교환요청 거부 처리 타입
export type CoupangRejectExchangeRequest = z.infer<
  typeof CoupangRejectExchangeRequestSchema
>;
export type CoupangRejectExchangeResponse = z.infer<
  typeof CoupangRejectExchangeResponseSchema
>;

// [추가] 교환상품 송장 업로드 처리 타입
export type CoupangUploadExchangeInvoiceRequest = z.infer<
  typeof CoupangUploadExchangeInvoiceRequestSchema
>;
export type CoupangUploadExchangeInvoiceResponse = z.infer<
  typeof CoupangUploadExchangeInvoiceResponseSchema
>;
// =================================================================
// == 5. 배송 히스토리 스키마 (Delivery History)
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
// == 6. 타입 추출 (Type Exports)
// =================================================================

// ===== 공통 타입 =====
export type Currency = z.infer<typeof CurrencySchema>;
export type CoupangDeliveryCompanyCode = z.infer<
  typeof CoupangDeliveryCompanyCodeSchema
>;
export type CoupangOrderStatus = z.infer<typeof CoupangOrderStatusSchema>;

// ===== 발주서/주문 타입 =====
export type Orderer = z.infer<typeof OrdererSchema>;
export type Receiver = z.infer<typeof ReceiverSchema>;
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

// ===== 발송/송장 타입 =====
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

// ===== 클레임 (반품/취소) 타입 =====
export type CoupangReturnItem = z.infer<typeof CoupangReturnItemSchema>;
export type CoupangReturnReceipt = z.infer<typeof CoupangReturnReceiptSchema>;
export type GetReturnRequestsParams = z.infer<
  typeof GetReturnRequestsParamsSchema
>;

export type GetReturnRequestsResponse = z.infer<
  typeof GetReturnRequestsResponseSchema
>;

// [추가] 반품요청 단건 조회 타입
export type SingleReturnItem = z.infer<typeof SingleReturnItemSchema>;
export type ReturnDeliveryDto = z.infer<typeof ReturnDeliveryDtoSchema>;
export type CoupangSingleReturnRequest = z.infer<
  typeof CoupangSingleReturnRequestSchema
>;
export type GetSingleReturnRequestResponse = z.infer<
  typeof GetSingleReturnRequestResponseSchema
>;
// [끝]

export type CoupangStoppedShipmentRequest = z.infer<
  typeof CoupangStoppedShipmentRequestSchema
>;
export type CoupangStoppedShipmentResponse = z.infer<
  typeof CoupangStoppedShipmentResponseSchema
>;
export type CoupangCompletedShipmentRequest = z.infer<
  typeof CoupangCompletedShipmentRequestSchema
>;
export type CoupangCompletedShipmentResponse = z.infer<
  typeof CoupangCompletedShipmentResponseSchema
>;

// ===== 배송 히스토리 타입 =====
export type CoupangDeliveryHistoryRequest = z.infer<
  typeof CoupangDeliveryHistoryRequestSchema
>;
export type CoupangDeliveryHistoryItem = z.infer<
  typeof CoupangDeliveryHistoryItemSchema
>;
export type CoupangDeliveryHistoryResponse = z.infer<
  typeof CoupangDeliveryHistoryResponseSchema
>; // ===== 상품/재고 타입 =====
export type CoupangUpdateStockResponse = z.infer<
  typeof CoupangUpdateStockResponseSchema
>;

// =================================================================
// == 7. 유틸리티 함수 (Utility Functions)
// =================================================================
export const COUPANG_STATUS_MAPPING = {
  ACCEPT: 'PAID',
  INSTRUCT: 'PREPARING',
  DEPARTURE: 'READY_TO_SHIP',
  DELIVERING: 'SHIPPED',
  FINAL_DELIVERY: 'DELIVERED',
  NONE_TRACKING: 'SHIPPED',
  SUCCESS: 'SUCCESS',
  PARTIAL_ERROR: 'PARTIAL_ERROR',
  FAILED: 'FAILED',
  NONE: 'NONE',
} as const;

/**
 * 쿠팡 상태를 내부 표준 상태로 매핑하는 함수
 */
export function mapCoupangStatusToInternal(coupangStatus: string): string {
  return (
    COUPANG_STATUS_MAPPING[
      coupangStatus as keyof typeof COUPANG_STATUS_MAPPING
    ] || coupangStatus
  );
}

/**
 * 날짜 범위 검증 함수 (최대 31일)
 */
export function validateCoupangDateRange(
  createdAtFrom: string,
  createdAtTo: string,
): boolean {
  // ISO 형식 (YYYY-MM-DDTHH:mm) 또는 단순 날짜 (YYYY-MM-DD) 모두 처리
  const fromDate = new Date(createdAtFrom.split('T')[0]);
  const toDate = new Date(createdAtTo.split('T')[0]);

  const diffTime = Math.abs(toDate.getTime() - fromDate.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return diffDays <= 31;
}

// =================================================================
// == [추가] 교환요청 목록 조회 스키마
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
// == [추가] 교환요청 상품 입고확인 처리 스키마
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
// == [추가] 교환요청 거부 처리 스키마
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
// == [추가] 교환상품 송장 업로드 처리 스키마
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
