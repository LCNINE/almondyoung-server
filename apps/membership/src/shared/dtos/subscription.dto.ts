import { z } from 'zod';

/**
 * 구독 생성 스키마
 */
export const CreateSubscriptionSchema = z.object({
  planId: z.string().uuid('유효한 UUID 형식이어야 합니다'),
});

export type CreateSubscriptionDto = z.infer<typeof CreateSubscriptionSchema>;

/**
 * 구독 업그레이드 스키마
 */
export const UpgradeSubscriptionSchema = z.object({
  newPlanId: z.string().uuid('유효한 UUID 형식이어야 합니다'),
});

export type UpgradeSubscriptionDto = z.infer<typeof UpgradeSubscriptionSchema>;

/**
 * 구독 다운그레이드 스키마
 */
export const DowngradeSubscriptionSchema = z.object({
  newPlanId: z.string().uuid('유효한 UUID 형식이어야 합니다'),
  effectiveDate: z
    .string()
    .datetime('유효한 날짜 형식이어야 합니다')
    .optional(),
});

export type DowngradeSubscriptionDto = z.infer<
  typeof DowngradeSubscriptionSchema
>;

/**
 * 구독 일시정지 스키마
 */
export const PauseSubscriptionSchema = z
  .object({
    startDate: z.string().datetime('유효한 날짜 형식이어야 합니다'),
    endDate: z.string().datetime('유효한 날짜 형식이어야 합니다'),
    reason: z.string().optional(),
  })
  .refine((data) => new Date(data.startDate) < new Date(data.endDate), {
    message: '시작일은 종료일보다 이전이어야 합니다',
    path: ['startDate'],
  });

export type PauseSubscriptionDto = z.infer<typeof PauseSubscriptionSchema>;

/**
 * 구독 취소 스키마
 */
export const CancelSubscriptionSchema = z.object({
  reason: z.string().optional(),
  effectiveDate: z
    .string()
    .datetime('유효한 날짜 형식이어야 합니다')
    .optional(),
});

export type CancelSubscriptionDto = z.infer<typeof CancelSubscriptionSchema>;

/**
 * 관리자 구독 강제 변경 스키마
 */
export const AdminOverrideSubscriptionSchema = z.object({
  newPlanId: z.string().uuid('유효한 UUID 형식이어야 합니다'),
  reason: z.string().min(1, '변경 사유는 필수입니다'),
  effectiveDate: z
    .string()
    .datetime('유효한 날짜 형식이어야 합니다')
    .optional(),
});

export type AdminOverrideSubscriptionDto = z.infer<
  typeof AdminOverrideSubscriptionSchema
>;

/**
 * 크레딧 지급 스키마
 */
export const AddCreditsSchema = z.object({
  amount: z.string().min(1, '금액은 필수입니다'),
  reason: z.string().min(1, '지급 사유는 필수입니다'),
});

export type AddCreditsDto = z.infer<typeof AddCreditsSchema>;

/**
 * 벌크 구독 확인 스키마
 */
export const BulkSubscriptionCheckSchema = z.object({
  userIds: z
    .array(z.string().uuid('유효한 UUID 형식이어야 합니다'))
    .min(1, '최소 1개의 사용자 ID가 필요합니다'),
});

export type BulkSubscriptionCheckDto = z.infer<
  typeof BulkSubscriptionCheckSchema
>;

// Zod 스키마 중복 선언 방지를 위한 코드 추가

// export const DowngradeSubscriptionSchema = z.object({
//   newPlanId: z.string().uuid('유효한 UUID 형식이어야 합니다'),
//   effectiveDate: z.string().datetime().optional(),
// });

// export const PauseSubscriptionSchema = z.object({
//   startDate: z.string().datetime('유효한 날짜 형식이어야 합니다'),
//   endDate: z.string().datetime('유효한 날짜 형식이어야 합니다'),
//   reason: z.string().optional(),
// });

// export const CancelSubscriptionSchema = z.object({
//   reason: z.string().optional(),
//   effectiveDate: z.string().datetime().optional(),
// });

// export const AdminOverrideSubscriptionSchema = z.object({
//   newPlanId: z.string().uuid('유효한 UUID 형식이어야 합니다'),
//   reason: z.string().min(1, '사유는 필수입니다'),
//   effectiveDate: z.string().datetime().optional(),
// });

// export const AddCreditsSchema = z.object({
//   amount: z.string().min(1, '금액은 필수입니다'),
//   reason: z.string().min(1, '사유는 필수입니다'),
// });
