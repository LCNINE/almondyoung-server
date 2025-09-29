import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

// ===== 기본 스키마들 =====

const PolicyScopeSchema = z
  .enum(['master', 'variant'] as const)
  .describe('정책 적용 범위');

const PolicyTypeSchema = z
  .enum(['price', 'discount', 'visibility'] as const)
  .describe('정책 유형');

// ===== 요청 스키마들 =====

// 멤버십 매핑 생성 스키마
export const CreateMembershipMappingSchema = z
  .object({
    membershipTierId: z
      .string()
      .uuid('유효한 UUID 형식이어야 합니다')
      .describe('멤버십 티어 ID'),
    price: z
      .number()
      .int('정수여야 합니다')
      .positive('양수여야 합니다')
      .optional()
      .describe('멤버십 전용 가격 (원 단위)'),
    discount: z
      .number()
      .int('정수여야 합니다')
      .min(1, '최소 1% 이상이어야 합니다')
      .max(100, '최대 100%까지 가능합니다')
      .optional()
      .describe('할인율 (%)'),
    visibilityOnly: z
      .boolean()
      .default(false)
      .describe(
        '가시성 전용 여부 (true인 경우 가격/할인 없이 접근 권한만 제어)',
      ),
    validFrom: z.iso.datetime().optional().describe('정책 유효 시작일'),
    validTo: z.iso
      .datetime()

      .optional()
      .describe('정책 유효 종료일'),
  })
  .refine(
    (data) => {
      // visibilityOnly가 true인 경우 price나 discount가 없어도 됨
      if (data.visibilityOnly) return true;
      // visibilityOnly가 false인 경우 price 또는 discount 중 하나는 필수
      return data.price !== undefined || data.discount !== undefined;
    },
    {
      message:
        'visibilityOnly가 false인 경우 price 또는 discount 중 하나는 필수입니다',
      path: ['price', 'discount'],
    },
  )
  .refine(
    (data) => {
      // price와 discount는 동시에 설정될 수 없음
      return !(data.price !== undefined && data.discount !== undefined);
    },
    {
      message: 'price와 discount는 동시에 설정할 수 없습니다',
      path: ['price', 'discount'],
    },
  )
  .refine(
    (data) => {
      // validTo가 있는 경우 validFrom보다 뒤여야 함
      if (data.validFrom && data.validTo) {
        return new Date(data.validTo) > new Date(data.validFrom);
      }
      return true;
    },
    {
      message: '종료일은 시작일보다 뒤여야 합니다',
      path: ['validTo'],
    },
  );

// 멤버십 매핑 수정 스키마
export const UpdateMembershipMappingSchema =
  CreateMembershipMappingSchema.partial().omit({ membershipTierId: true }); // 티어 ID는 수정 불가

// ===== 응답 스키마들 =====

// 멤버십 매핑 응답 스키마
export const MembershipMappingSchema = z.object({
  id: z.uuid().describe('정책 ID'),
  masterId: z.uuid().nullable().describe('상품 마스터 ID'),
  variantId: z.uuid().nullable().describe('상품 변형 ID'),
  membershipTierId: z.uuid().describe('멤버십 티어 ID'),
  price: z.number().int().nullable().describe('멤버십 전용 가격'),
  discount: z.number().int().nullable().describe('할인율 (%)'),
  visibilityOnly: z.boolean().describe('가시성 전용 여부'),
  validFrom: z.iso.datetime().describe('유효 시작일'),
  validTo: z.iso.datetime().nullable().describe('유효 종료일'),
  createdAt: z.iso.datetime().describe('생성일시'),
});

// 멤버십 티어 정보 스키마
export const MembershipTierSchema = z.object({
  id: z.uuid().describe('티어 ID'),
  code: z.string().describe('티어 코드'),
  name: z.string().describe('티어 이름'),
  priorityLevel: z.number().int().describe('우선순위 레벨'),
});

// 가격 계산 결과 스키마
export const MembershipPriceCalculationSchema = z.object({
  originalPrice: z.number().int().describe('원래 가격'),
  membershipPrice: z.number().int().describe('멤버십 적용 가격'),
  discount: z.number().int().optional().describe('적용된 할인율 (%)'),
  discountAmount: z.number().int().describe('할인 금액'),
  policyApplied: MembershipMappingSchema.nullable().describe('적용된 정책'),
  tierInfo: MembershipTierSchema.describe('멤버십 티어 정보'),
});

// 가격 계산 요청 스키마
export const CalculatePriceRequestSchema = z.object({
  masterId: z.uuid().describe('상품 마스터 ID'),
  variantId: z.uuid().optional().describe('상품 변형 ID'),
  membershipTierId: z.uuid().optional().describe('멤버십 티어 ID'),
  userId: z.uuid().optional().describe('사용자 ID'),
});

// 상품 가시성 확인 응답 스키마
export const ProductVisibilitySchema = z.object({
  visible: z.boolean().describe('상품 가시성 여부'),
  reason: z.string().optional().describe('비가시 사유'),
  requiredTierLevel: z
    .number()
    .int()
    .optional()
    .describe('필요한 최소 티어 레벨'),
});

// 페이징된 정책 목록 응답 스키마
export const PaginatedMappingsSchema = z.object({
  data: z.array(MembershipMappingSchema).describe('정책 목록'),
  total: z.number().int().describe('전체 개수'),
  page: z.number().int().describe('현재 페이지'),
  limit: z.number().int().describe('페이지당 개수'),
});

// ===== DTO 클래스들 =====

export class CreateMembershipMappingDto extends createZodDto(
  CreateMembershipMappingSchema,
) {}

export class UpdateMembershipMappingDto extends createZodDto(
  UpdateMembershipMappingSchema,
) {}

export class MembershipMappingDto extends createZodDto(
  MembershipMappingSchema,
) {}

export class MembershipTierDto extends createZodDto(MembershipTierSchema) {}

export class MembershipPriceCalculationDto extends createZodDto(
  MembershipPriceCalculationSchema,
) {}

export class CalculatePriceRequestDto extends createZodDto(
  CalculatePriceRequestSchema,
) {}

export class ProductVisibilityDto extends createZodDto(
  ProductVisibilitySchema,
) {}

export class PaginatedMappingsDto extends createZodDto(
  PaginatedMappingsSchema,
) {}

// ===== 타입 추출 =====

export type PolicyScope = z.infer<typeof PolicyScopeSchema>;
export type PolicyType = z.infer<typeof PolicyTypeSchema>;
export type CreateMembershipMappingType = z.infer<
  typeof CreateMembershipMappingSchema
>;
export type UpdateMembershipMappingType = z.infer<
  typeof UpdateMembershipMappingSchema
>;
export type MembershipMappingType = z.infer<typeof MembershipMappingSchema>;
export type MembershipTierType = z.infer<typeof MembershipTierSchema>;
export type MembershipPriceCalculationType = z.infer<
  typeof MembershipPriceCalculationSchema
>;
export type CalculatePriceRequestType = z.infer<
  typeof CalculatePriceRequestSchema
>;
export type ProductVisibilityType = z.infer<typeof ProductVisibilitySchema>;
export type PaginatedMappingsType = z.infer<typeof PaginatedMappingsSchema>;
