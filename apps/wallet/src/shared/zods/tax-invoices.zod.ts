import { z } from 'zod';

// ===============================
// 기본 검증 스키마들
// ===============================
const businessNumberSchema = z
  .string()
  .regex(/^\d{10}$/, { message: '사업자등록번호는 숫자만 10자리여야 합니다.' });

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
  message: '날짜는 YYYY-MM-DD 형식이어야 합니다.',
});

const taxTypeEnum = z.enum(['일반', '영세율']); // 필요시 영세율 위수탁 등 추가

// ===============================
// 세금계산서 생성 DTO 스키마
// ===============================
export const CreateTaxInvoiceSchema = z.object({
  userId: z.string().min(1, '사용자 ID가 필요합니다.'),
  externalOrderId: z.string().min(1, '외부 주문 ID가 필요합니다.'),
  paymentIntentId: z.string().optional(),
  paymentAttemptId: z.string().optional(),

  // 기본 정보
  supplyDate: dateSchema,
  issueDate: dateSchema,
  totalAmount: z.number().int().positive('총액은 양수여야 합니다.'),

  // 세금계산서 종류
  kind: z.enum(['NORMAL', 'MODIFICATION']).default('NORMAL'),
  modificationType: z.enum(['INCREASE', 'DECREASE', 'CANCEL']).optional(),
  originalInvoiceId: z.string().optional(),

  // 합산 정보
  aggregationType: z
    .enum(['SINGLE', 'DAILY', 'WEEKLY', 'MONTHLY'])
    .default('SINGLE'),
  aggregationKey: z.string().optional(),

  // 고객 정보
  customerName: z.string().min(1, '고객명이 필요합니다.'),
  customerBusinessNumber: businessNumberSchema.optional(),

  // 금액 상세
  supplyAmount: z.number().int().min(0, '공급가액은 음수가 될 수 없습니다.'),
  taxAmount: z.number().int().min(0, '세액은 음수가 될 수 없습니다.'),

  // 스냅샷 데이터
  invoiceSnapshot: z.object({
    supplier: z.object({
      businessNumber: businessNumberSchema,
      name: z.string().min(1),
      ceoName: z.string().min(1),
      address: z.string().min(1),
      email: z.string().email().optional(),
      businessType: z.string().optional(),
      businessCategory: z.string().optional(),
    }),
    customer: z.object({
      businessNumber: businessNumberSchema.optional(),
      name: z.string().min(1),
      ceoName: z.string().optional(),
      address: z.string().optional(),
      email: z.string().email().optional(),
    }),
    items: z
      .array(
        z.object({
          name: z.string().min(1),
          spec: z.string().optional(),
          quantity: z.number().positive().optional(),
          unitPrice: z.number().positive().optional(),
          supplyAmount: z.number().int().min(0),
          taxAmount: z.number().int().min(0),
        }),
      )
      .min(1, '최소 1개의 품목이 필요합니다.'),
    orderMeta: z
      .object({
        orderDate: dateSchema.optional(),
        deliveryDate: dateSchema.optional(),
        shippingAddress: z.string().optional(),
      })
      .optional(),
    aggregatedOrderIds: z.array(z.string()).optional(),
  }),
});

// ===============================
// 세금계산서 조회 필터 스키마
// ===============================
export const TaxInvoiceFilterSchema = z.object({
  userId: z.string().optional(),
  status: z.enum(['PENDING', 'ISSUED', 'CANCELLED']).optional(),
  supplyDateFrom: dateSchema.optional(),
  supplyDateTo: dateSchema.optional(),
  batchId: z.string().optional(),
  externalOrderId: z.string().optional(),
  limit: z.number().int().positive().max(1000).default(50),
  offset: z.number().int().min(0).default(0),
});

// ===============================
// 배치 처리 스키마
// ===============================
export const ExportBatchSchema = z.object({
  batchPeriod: z
    .string()
    .regex(/^\d{4}-\d{2}$/, '배치 기간은 YYYY-MM 형식이어야 합니다.'),
  maxRecords: z.number().int().positive().max(1000).default(1000),
  includeModifications: z.boolean().default(true),
});

export const UpdateBatchResultSchema = z.object({
  batchId: z.string().min(1, '배치 ID가 필요합니다.'),
  results: z
    .array(
      z.object({
        invoiceId: z.string().min(1),
        approved: z.boolean(),
        approvalNumber: z.string().optional(),
        errorMessage: z.string().optional(),
      }),
    )
    .min(1, '최소 1개의 결과가 필요합니다.'),
});

// ===============================
// 엑셀 export용 스키마 (기존 유지)
// ===============================
const taxInvoiceRowSchema = z.object({
  // 공급자 정보
  supplierBusinessNumber: businessNumberSchema,
  supplierBranchNumber: z.string().optional(), // 종사업장번호: 있을 수도 없음
  supplierName: z.string().min(1, '공급자 상호(법인명)가 필요합니다.'),
  supplierCeoName: z.string().min(1, '공급자 대표자명이 필요합니다.'),
  supplierAddress: z.string().min(1, '공급자 주소가 필요합니다.'),
  supplierEmail: z.string().email().optional(), // 이메일은 형식 체크, 필수 여부는 사업장별

  // 업태/업종/종목
  supplierBusinessType: z.string().min(1, '업태가 필요합니다.'),
  supplierBusinessCategory: z.string().min(1, '업종(종목)이 필요합니다.'),

  // 종류
  taxType: taxTypeEnum,

  // 공급받는자 정보
  customerBusinessNumber: businessNumberSchema,
  customerName: z.string().min(1, '공급받는자 상호/성이 필요합니다.'),
  customerCeoName: z.string().optional(),
  customerAddress: z.string().min(1, '공급받는자 주소가 필요합니다.'),

  // 작성일자
  issueDate: dateSchema,

  // 품목
  itemName: z.string().min(1, '품목명이 필요합니다.'),
  spec: z.string().optional(),
  quantity: z.number().int().positive().optional(),
  unitPrice: z.number().positive().optional(),

  // 금액들
  supplyAmount: z.number().int().min(0, '공급가액은 음수가 될 수 없습니다.'),
  taxAmount: z.number().int().min(0, '세액은 음수가 될 수 없습니다.'),
  totalAmount: z.number().int().min(0, '합계금액은 음수가 될 수 없습니다.'),

  // 추가 옵션
  remark: z.string().optional(),
});

// 전체 엑셀 파일 (여러 행)
export const taxInvoiceExcelSchema = z.array(taxInvoiceRowSchema);

// ===============================
// DTO 타입 추론
// ===============================
export type CreateTaxInvoiceDto = z.infer<typeof CreateTaxInvoiceSchema>;
export type TaxInvoiceFilterDto = z.infer<typeof TaxInvoiceFilterSchema>;
export type ExportBatchDto = z.infer<typeof ExportBatchSchema>;
export type UpdateBatchResultDto = z.infer<typeof UpdateBatchResultSchema>;
export type TaxInvoiceRowDto = z.infer<typeof taxInvoiceRowSchema>;
