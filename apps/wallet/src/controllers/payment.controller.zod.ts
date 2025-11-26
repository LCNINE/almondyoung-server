import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

// ===== ZOD 스키마 정의 =====

// 기본 응답 스키마
const BaseResponseSchema = z.object({
  success: z.boolean(),
  timestamp: z.string().optional(),
});

const ErrorResponseSchema = z.object({
  success: z.literal(false),
  message: z.string(),
  statusCode: z.number(),
  timestamp: z.string().optional(),
});

// Intent 관련 스키마
export const CreateIntentSchema = z.object({
  customerId: z.string().min(1, '고객 ID는 필수입니다.'),
  originalAmount: z.number().int().positive('금액은 양수여야 합니다.'),
  discountAmount: z.number().int().positive('할인 금액은 양수여야 합니다.'),
  type: z.enum(['ORDER', 'BNPL_CAPTURE', 'MEMBERSHIP_FEE'], {
    error: '유효하지 않은 결제 타입입니다.',
  }),
});

const IntentResponseSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  amount: z.number(),
  type: z.string(),
  status: z.string(),
  // z.date() 대신 문자열로 처리 (JSON Schema 호환성)
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  metadata: z.any().optional(),
  // 실제 서비스에서 반환되는 추가 필드들
  capturedAt: z.string().datetime().nullable().optional(),
});

// 결제 승인 관련 스키마
export const AuthorizePaymentSchema = z
  .object({
    authParams: z.record(z.string(), z.string()).optional(),
    profileId: z.string().optional(),
    provider: z.enum(['TOSS', 'HMS_CARD', 'HMS_BNPL']),
    usePoints: z.number().int().nonnegative().optional(),
  })
  .refine(
    (data) => {
      const hasAuthParams = !!data.authParams && Object.keys(data.authParams).length > 0;
      const hasProfileId = !!data.profileId;
      return (hasAuthParams && !hasProfileId) || (!hasAuthParams && hasProfileId);
    },
    { message: 'Either authParams or profileId required, but not both' },
  );

const AuthorizePaymentResponseSchema = BaseResponseSchema.extend({
  intentId: z.string(),
  attemptId: z.string().optional(), // 실제로는 undefined일 수 있음
  status: z.string(), // 실제로는 다양한 상태값이 가능
  provider: z.string(),
  amount: z.number(),
  paymentKey: z.string(),
  message: z.string(),
  pointEventId: z.number().optional(), // 포인트 차감 이벤트 ID
  breakdown: z
    .object({
      totalAmount: z.number(),
      pointsUsed: z.number(),
      finalAmount: z.number(),
    })
    .optional(),
});

// 결제 캡처 관련 스키마
export const CapturePaymentSchema = z.object({
  attemptId: z.string().min(1, 'attemptId는 필수입니다.'),
  amount: z.number().int().positive().optional(),
});

const CapturePaymentResponseSchema = BaseResponseSchema.extend({
  intentId: z.string('intentId는 필수입니다.'),
  attemptId: z.string('attemptId는 필수입니다.'),
  status: z.string(), // 실제로는 다양한 상태값이 가능
  amount: z.number().optional(),
  message: z.string('message는 필수입니다.'),
});

// HMS 카드 프로필 관련 스키마
export const CreateHmsCardProfileSchema = z.object({
  // userId는 JWT에서 추출되므로 optional로 변경
  userId: z.string().min(1, '사용자 ID는 필수입니다.').optional(),
  // memberId는 서버에서 자동 생성되므로 optional로 변경
  memberId: z.string().min(1).max(20, '회원 ID는 20자 이내여야 합니다.').optional(),
  memberName: z.string().min(1).max(25, '회원명은 25자 이내여야 합니다.'),
  phone: z
    .string()
    .min(10, '전화번호는 10-11자리여야 합니다')
    .max(11, '전화번호는 10-11자리여야 합니다')
    .regex(/^01[0-9]{8,9}$/, '올바른 휴대폰번호 형식이 아닙니다 (예: 01012345678)'),
  payerNumber: z
    .string()
    .max(10, '10자 이내로 입력해주세요')
    .min(6, '6자리 생년월일을 입력해주세요')
    .regex(/^\d+$/, '숫자만 입력해주세요'),
  paymentNumber: z
    .string()
    .length(16, '카드번호는 정확히 16자리여야 합니다')
    .regex(/^\d+$/, '숫자만 입력해주세요')
    .refine((val) => parseInt(val.slice(-1)) % 2 === 0, {
      message: '테스트 환경에서는 카드번호 끝자리가 짝수여야 합니다',
    }),
  payerName: z.string().max(10, '10자 이내로 입력해주세요').min(1, '납부자명을 입력해주세요'),
  validYear: z.string().length(2, '카드 유효기간 년도 2자리를 입력해주세요').regex(/^\d+$/, '숫자만 입력해주세요'),
  validMonth: z
    .string()
    .length(2, '카드 유효기간 월 2자리를 입력해주세요')
    .regex(/^(0[1-9]|1[0-2])$/, '월은 01-12 사이여야 합니다'),
  validUntil: z.string().length(4, '카드 유효기간 4자리를 입력해주세요'),
  password: z.string().length(2, '비밀번호 앞 2자리를 입력해주세요').regex(/^\d+$/, '숫자만 입력해주세요'),
  paymentCompany: z.string().max(3, '결제 기관 코드를 입력해주세요').optional(),
});

// HMS 카드 프로필 응답은 실제로는 문자열을 반환할 수 있음
const HmsCardProfileResponseSchema = z.object({
  profileId: z.string(),
  userId: z.string(),
  status: z.string(),
  message: z.string(),
});

// HMS BNPL 프로필 관련 스키마
// userId는 JWT에서 추출하므로 스키마에서 제외
export const OnboardHmsBnplProfileSchema = z.object({
  payerName: z.string().trim().min(1, { message: '납부자명은 필수입니다.' }),
  phone: z.string().trim().min(10, { message: '올바른 전화번호를 입력해주세요.' }),
  paymentCompany: z.string().trim().min(1, { message: '은행 코드는 필수입니다.' }),
  paymentNumber: z.string().trim().min(1, { message: '계좌 번호는 필수입니다.' }),
  payerNumber: z
    .string()
    .trim()
    .length(10, { message: '납부자 번호는 10자리여야 합니다' })
    .regex(/^\d{10}$/, { message: '납부자 번호는 숫자 10자리여야 합니다' }),
  name: z.string().optional().nullable(), // 프로필 별칭
});

// BNPL 계정 관련 스키마
export const CreateBnplAccountSchema = z.object({
  userId: z.string().trim().min(1, { message: '사용자 ID는 필수입니다.' }),
  creditLimit: z.number().int().positive({ message: '신용 한도는 양수여야 합니다.' }),
});

// 환불 관련 스키마
export const RefundPaymentSchema = z.object({
  amount: z.number().int().positive().optional(), // 환불 금액 (미지정 시 전액)
  reason: z.string().optional(), // 환불 사유
});

const RefundPaymentResponseSchema = BaseResponseSchema.extend({
  refunded: z.object({
    points: z.number(),
    cash: z.number(),
    total: z.number(),
  }),
  status: z.string(),
});

// DTO 클래스 생성
export class CreateIntentDto extends createZodDto(CreateIntentSchema) {}
export class AuthorizePaymentDto extends createZodDto(AuthorizePaymentSchema) {}
export class CapturePaymentDto extends createZodDto(CapturePaymentSchema) {}
export class RefundPaymentDto extends createZodDto(RefundPaymentSchema) {}
export class CreateHmsCardProfileDto extends createZodDto(CreateHmsCardProfileSchema) {}

export class CreateBnplAccountDto extends createZodDto(CreateBnplAccountSchema) {}

// Response DTO 클래스
export class IntentResponseDto extends createZodDto(IntentResponseSchema) {}
export class AuthorizePaymentResponseDto extends createZodDto(AuthorizePaymentResponseSchema) {}
export class CapturePaymentResponseDto extends createZodDto(CapturePaymentResponseSchema) {}
export class HmsCardProfileResponseDto extends createZodDto(HmsCardProfileResponseSchema) {}

export class RefundPaymentResponseDto extends createZodDto(RefundPaymentResponseSchema) {}
export class ErrorResponseDto extends createZodDto(ErrorResponseSchema) {}

// 타입 추론 (기존 호환성을 위해)
export type CreateIntentDtoType = z.infer<typeof CreateIntentSchema>;
export type AuthorizePaymentDtoType = z.infer<typeof AuthorizePaymentSchema>;
export type CapturePaymentDtoType = z.infer<typeof CapturePaymentSchema>;
export type RefundPaymentDtoType = z.infer<typeof RefundPaymentSchema>;
export type CreateHmsCardProfileDtoType = z.infer<typeof CreateHmsCardProfileSchema>;

export type CreateBnplAccountDtoType = z.infer<typeof CreateBnplAccountSchema>;

// BNPL History & Summary Schemas
export const BnplHistoryQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
});

const BnplEventSchema = z.object({
  id: z.string({ message: '이벤트 ID는 필수입니다.' }),
  eventType: z.string({ message: '이벤트 타입은 필수입니다.' }),
  eventCategory: z.string({ message: '이벤트 카테고리는 필수입니다.' }),
  amount: z.number({ message: '금액은 필수입니다.' }),
  status: z.string({ message: '상태는 필수입니다.' }),
  createdAt: z.iso.datetime({ message: '생성 일시는 필수입니다.' }),
  title: z.string({ message: '제목은 문자열이어야 합니다.' }).optional(), // UI 표시용 (예: 상점명)
});

const BnplHistoryResponseSchema = BaseResponseSchema.extend({
  year: z.number({ message: '연도는 필수입니다.' }),
  month: z.number({ message: '월은 필수입니다.' }),
  totalAmount: z.number({ message: '총 금액은 필수입니다.' }),
  events: z.array(BnplEventSchema, { message: '이벤트는 배열이어야 합니다.' }),
});

const BnplSummaryResponseSchema = BaseResponseSchema.extend({
  hasAccount: z.boolean(),
  creditLimit: z.number({ message: '신용 한도는 필수입니다.' }).nullable(),
  availableLimit: z.number({ message: '사용 가능 한도는 필수입니다.' }).nullable(),
  usedAmount: z.number({ message: '사용 금액은 필수입니다.' }).nullable(),
  nextBillingDate: z.string({ message: '다음 결제일은 문자열이어야 합니다.' }).nullable(),
  dDay: z.number({ message: 'D-Day는 숫자이어야 합니다.' }).nullable(), // 결제일까지 남은 일수
  targetYear: z.number({ message: '청구 대상 연도는 필수입니다.' }).nullable(), // 청구 대상 연도
  targetMonth: z.number({ message: '청구 대상 월은 필수입니다.' }).nullable(), // 청구 대상 월
});

export class BnplHistoryQueryDto extends createZodDto(BnplHistoryQuerySchema) {}
export class BnplHistoryResponseDto extends createZodDto(BnplHistoryResponseSchema) {}
export class BnplSummaryResponseDto extends createZodDto(BnplSummaryResponseSchema) {}

// 결제 프로필 관리 응답 스키마
const SetDefaultProfileResponseSchema = BaseResponseSchema.extend({
  profileId: z.string(),
  isDefault: z.boolean(),
  message: z.string(),
});

const DeleteProfileResponseSchema = BaseResponseSchema.extend({
  profileId: z.string(),
  deletedAt: z.string().datetime(),
  message: z.string(),
});

export class SetDefaultProfileResponseDto extends createZodDto(SetDefaultProfileResponseSchema) {}
export class DeleteProfileResponseDto extends createZodDto(DeleteProfileResponseSchema) {}
