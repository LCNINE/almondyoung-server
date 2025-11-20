import { z } from 'zod';

// ===============================
// 기본 검증 스키마들
// ===============================
const businessNumberSchema = z
  .string()
  .regex(/^\d{3}-?\d{2}-?\d{5}$/, {
    message: '사업자등록번호는 000-00-00000 형식이어야 합니다.',
  });

// ===============================
// 사업자 정보 스키마
// ===============================
export const BusinessInfoSchema = z.object({
  name: z.string().min(1, '사업자명이 필요합니다.'),
  businessNumber: businessNumberSchema,
  address: z.string().min(1, '사업장 주소가 필요합니다.'),
  ownerName: z.string().min(1, '대표자명이 필요합니다.'),
});

// ===============================
// 세금계산서 신청 DTO (명세서 기준)
// ===============================
export const CreateIntentSchema = z.object({
  orderId: z.string().min(1, '주문 ID가 필요합니다.'),
  businessInfo: BusinessInfoSchema.optional(), // preference 없을 때 필수
});

// ===============================
// 세금계산서 기본 설정 업데이트 DTO
// ===============================
export const UpdatePreferenceSchema = z.object({
  defaultEnabled: z.boolean(),
  defaultBusinessInfo: BusinessInfoSchema.optional(),
});

// ===============================
// 관리자: 엑셀 내보내기 처리 DTO
// ===============================
export const MarkExportedSchema = z.object({
  invoiceIds: z
    .array(z.string().min(1))
    .min(1, '최소 1개의 세금계산서 ID가 필요합니다.'),
  operator: z.string().min(1, '담당자 ID가 필요합니다.'),
});

// ===============================
// 관리자: 발행 완료 처리 DTO
// ===============================
export const ConfirmIssuedSchema = z.object({
  hometaxIssueNo: z.string().min(1, '홈택스 발행번호가 필요합니다.'),
  hometaxIssueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: '발행일자는 YYYY-MM-DD 형식이어야 합니다.',
  }),
});

// ===============================
// 관리자: 발행 실패 처리 DTO
// ===============================
export const MarkFailedSchema = z.object({
  failReason: z.string().min(1, '실패 사유가 필요합니다.'),
  errorCode: z.string().optional(),
});

// ===============================
// 관리자: 취소 처리 DTO
// ===============================
export const CancelInvoiceSchema = z.object({
  cancelReason: z.string().min(1, '취소 사유가 필요합니다.'),
});

// ===============================
// OMS 웹훅 이벤트 DTO
// ===============================
export const OmsOrderUpdatedSchema = z.object({
  eventId: z.string().min(1, '이벤트 ID가 필요합니다.'),
  orderId: z.string().min(1, '주문 ID가 필요합니다.'),
  userId: z.string().min(1, '사용자 ID가 필요합니다.'),
  eventType: z.enum(['CANCELLED', 'REFUNDED', 'PARTIAL_REFUNDED']),
  amount: z.number().int().min(0, '금액은 음수가 될 수 없습니다.').optional(),
  timestamp: z.string().datetime(),
});

// ===============================
// 조회 필터 DTO
// ===============================
export const GetMyInvoicesSchema = z.object({
  status: z
    .enum([
      'REQUESTED',
      'EXPORTED',
      'ISSUED_CONFIRMED',
      'FAILED',
      'CANCELLED',
      'NEEDS_MODIFICATION',
    ])
    .optional(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const GetAdminInvoicesSchema = z.object({
  status: z
    .enum([
      'REQUESTED',
      'EXPORTED',
      'ISSUED_CONFIRMED',
      'FAILED',
      'CANCELLED',
      'NEEDS_MODIFICATION',
    ])
    .optional(),
  userId: z.string().optional(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().positive().max(1000).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// ===============================
// DTO 타입 추론
// ===============================
export type BusinessInfoDto = z.infer<typeof BusinessInfoSchema>;
export type CreateIntentDto = z.infer<typeof CreateIntentSchema>;
export type UpdatePreferenceDto = z.infer<typeof UpdatePreferenceSchema>;
export type MarkExportedDto = z.infer<typeof MarkExportedSchema>;
export type ConfirmIssuedDto = z.infer<typeof ConfirmIssuedSchema>;
export type MarkFailedDto = z.infer<typeof MarkFailedSchema>;
export type CancelInvoiceDto = z.infer<typeof CancelInvoiceSchema>;
export type OmsOrderUpdatedDto = z.infer<typeof OmsOrderUpdatedSchema>;
export type GetMyInvoicesDto = z.infer<typeof GetMyInvoicesSchema>;
export type GetAdminInvoicesDto = z.infer<typeof GetAdminInvoicesSchema>;
