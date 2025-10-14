import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { paymentIntentTypeEnum } from '../shared/database';
import { ProviderType } from '../providers/payment-provider.interface';

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
  amount: z.number().int().positive('금액은 양수여야 합니다.'),
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
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  metadata: z.any().optional(),
  // 실제 서비스에서 반환되는 추가 필드들
  capturedAt: z.iso.datetime().nullable().optional(),
});

// 결제 승인 관련 스키마
export const AuthorizePaymentSchema = z.object({
  provider: z.string().min(1).optional(), // ✅ 포인트 전액 결제 시 불필요
  paymentKey: z.string().min(1).optional(), // ✅ 포인트 전액 결제 시 불필요
  usePoints: z.number().int().nonnegative().optional(), // 포인트 사용 금액
});

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
  intentId: z.string(),
  attemptId: z.string(),
  status: z.string(), // 실제로는 다양한 상태값이 가능
  amount: z.number().optional(),
  message: z.string(),
});

// 결제 실행 (레거시) 응답 스키마
const ExecutePaymentResponseSchema = BaseResponseSchema.extend({
  intentId: z.string(),
  status: z.literal('CAPTURED'),
  provider: z.string(),
  amount: z.number(),
  paymentKey: z.string(),
  message: z.string(),
});

// HMS 카드 프로필 관련 스키마
export const CreateHmsCardProfileSchema = z.object({
  userId: z.string().min(1, '사용자 ID는 필수입니다.'),
  memberId: z.string().min(1).max(20, '회원 ID는 20자 이내여야 합니다.'),
  memberName: z.string().min(1).max(25, '회원명은 25자 이내여야 합니다.'),
  phone: z
    .string()
    .max(12, '전화번호 형식이 잘못되었습니다')
    .min(1, '전화번호를 입력해주세요')
    .regex(/^\d+$/, '숫자만 입력해주세요'),
  payerNumber: z
    .string()
    .max(10, '10자 이내로 입력해주세요')
    .min(6, '6자리 생년월일을 입력해주세요')
    .regex(/^\d+$/, '숫자만 입력해주세요'),
  paymentNumber: z
    .string()
    .max(16, '16자 이내로 입력해주세요')
    .min(1, '카드번호를 입력해주세요')
    .regex(/^\d+$/, '숫자만 입력해주세요'),
  payerName: z
    .string()
    .max(10, '10자 이내로 입력해주세요')
    .min(1, '납부자명을 입력해주세요'),
  validYear: z
    .string()
    .length(2, '카드 유효기간 년도 2자리를 입력해주세요')
    .regex(/^\d+$/, '숫자만 입력해주세요'),
  validMonth: z
    .string()
    .length(2, '카드 유효기간 월 2자리를 입력해주세요')
    .regex(/^\d+$/, '숫자만 입력해주세요'),
  validUntil: z.string().length(4, '카드 유효기간 4자리를 입력해주세요'),
  password: z
    .string()
    .length(2, '비밀번호 앞 2자리를 입력해주세요')
    .regex(/^\d+$/, '숫자만 입력해주세요'),
  paymentCompany: z.string().max(3, '결제 기관 코드를 입력해주세요'),
});

// HMS 카드 프로필 응답은 실제로는 문자열을 반환할 수 있음
const HmsCardProfileResponseSchema = z.object({
  profileId: z.string(),
  userId: z.string(),
  status: z.string(),
  message: z.string(),
});

// HMS BNPL 프로필 관련 스키마
export const OnboardHmsBnplProfileSchema = z.object({
  userId: z.string().trim().min(1, '사용자 ID는 필수입니다.'),
  payerName: z.string().trim().min(1, '납부자명은 필수입니다.'),
  phone: z.string().trim().min(10, '올바른 전화번호를 입력해주세요.'),
  paymentCompany: z.string().trim().min(1, '은행 코드는 필수입니다.'),
  paymentNumber: z.string().trim().min(1, '계좌 번호는 필수입니다.'),
  payerNumber: z.string().trim().min(6, '생년월일 6자리를 입력해주세요.'),
  name: z.string().optional().nullable(), // 프로필 별칭
});

const OnboardHmsBnplProfileResponseSchema = BaseResponseSchema.extend({
  profileId: z.string(),
  userId: z.string(),
  status: z.string(),
  agreementFileUrl: z.string().optional(),
  message: z.string(),
});

// BNPL 계정 관련 스키마
export const CreateBnplAccountSchema = z.object({
  userId: z.string().trim().min(1, '사용자 ID는 필수입니다.'),
  creditLimit: z.number().int().positive('신용 한도는 양수여야 합니다.'),
});

const CreateBnplAccountResponseSchema = BaseResponseSchema.extend({
  accountId: z.string(),
  userId: z.string(),
  creditLimit: z.number(),
  availableLimit: z.number(),
  status: z.string(),
});

// 체크아웃 관련 스키마
export const CreateCheckoutSessionSchema = z.object({
  intentId: z.string().min(1, 'intentId는 필수입니다.'),
  returnUrl: z.string().url('올바른 URL 형식이 아닙니다.'),
  cancelUrl: z.string().url('올바른 URL 형식이 아닙니다.'),
});

// 실제 서비스에서 반환하는 체크아웃 세션 응답 형식
const CreateCheckoutSessionResponseSchema = z.object({
  sessionId: z.string(),
  paymentUrl: z.string(),
  // 실제로는 success, expiresAt이 없을 수 있음
  success: z.boolean().optional(),
  expiresAt: z.string().optional(),
});

const CheckoutUIDataResponseSchema = z.object({
  intentId: z.string(),
  amount: z.number(),
  orderName: z.string(),
  allowedProviders: z.array(z.string()),
  clientConfig: z.record(z.string(), z.any()),
});

// Process Intent 스키마 (기존 코드에서 사용)
export const ProcessIntentSchema = z.object({
  providerType: z.nativeEnum(ProviderType),
  profileId: z.string().optional(),
  instrumentRef: z.string().optional(),
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
export class CreateHmsCardProfileDto extends createZodDto(
  CreateHmsCardProfileSchema,
) {}
export class OnboardHmsBnplProfileDto extends createZodDto(
  OnboardHmsBnplProfileSchema,
) {}
export class CreateBnplAccountDto extends createZodDto(
  CreateBnplAccountSchema,
) {}
export class CreateCheckoutSessionDto extends createZodDto(
  CreateCheckoutSessionSchema,
) {}
export class ProcessIntentDto extends createZodDto(ProcessIntentSchema) {}

// Response DTO 클래스
export class IntentResponseDto extends createZodDto(IntentResponseSchema) {}
export class AuthorizePaymentResponseDto extends createZodDto(
  AuthorizePaymentResponseSchema,
) {}
export class CapturePaymentResponseDto extends createZodDto(
  CapturePaymentResponseSchema,
) {}
export class ExecutePaymentResponseDto extends createZodDto(
  ExecutePaymentResponseSchema,
) {}
export class HmsCardProfileResponseDto extends createZodDto(
  HmsCardProfileResponseSchema,
) {}
export class OnboardHmsBnplProfileResponseDto extends createZodDto(
  OnboardHmsBnplProfileResponseSchema,
) {}
export class CreateBnplAccountResponseDto extends createZodDto(
  CreateBnplAccountResponseSchema,
) {}
export class CreateCheckoutSessionResponseDto extends createZodDto(
  CreateCheckoutSessionResponseSchema,
) {}
export class CheckoutUIDataResponseDto extends createZodDto(
  CheckoutUIDataResponseSchema,
) {}
export class RefundPaymentResponseDto extends createZodDto(
  RefundPaymentResponseSchema,
) {}
export class ErrorResponseDto extends createZodDto(ErrorResponseSchema) {}

// 타입 추론 (기존 호환성을 위해)
export type CreateIntentDtoType = z.infer<typeof CreateIntentSchema>;
export type AuthorizePaymentDtoType = z.infer<typeof AuthorizePaymentSchema>;
export type CapturePaymentDtoType = z.infer<typeof CapturePaymentSchema>;
export type RefundPaymentDtoType = z.infer<typeof RefundPaymentSchema>;
export type CreateHmsCardProfileDtoType = z.infer<
  typeof CreateHmsCardProfileSchema
>;
export type OnboardHmsBnplProfileDtoType = z.infer<
  typeof OnboardHmsBnplProfileSchema
>;
export type CreateBnplAccountDtoType = z.infer<typeof CreateBnplAccountSchema>;
export type CreateCheckoutSessionDtoType = z.infer<
  typeof CreateCheckoutSessionSchema
>;
export type ProcessIntentDtoType = z.infer<typeof ProcessIntentSchema>;
