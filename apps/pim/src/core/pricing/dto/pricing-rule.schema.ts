import { z } from 'zod';

// ============================================================================
// Base Zod Schema (간결하게 discriminated union 사용)
// ============================================================================

const basePricingRuleSchema = z
  .object({
    layer: z.enum(['base_price', 'membership_price', 'tiered_price']),
    order: z.number().int().min(1),
    scopeType: z.enum(['all_variants', 'with_option', 'variants']),
    scopeTargetIds: z.array(z.string().uuid()).optional(),
    operationType: z.enum(['offset', 'scale', 'override']),
    operationValue: z.number().int(),
    minQuantity: z.number().int().positive().optional(),
  })
  .superRefine((data, ctx) => {
    // Scope 검증: all_variants는 scopeTargetIds 불필요
    if (data.scopeType === 'all_variants') {
      if (data.scopeTargetIds && data.scopeTargetIds.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'all_variants scope should not have scopeTargetIds',
          path: ['scopeTargetIds'],
        });
      }
    } else {
      // with_option, variants는 scopeTargetIds 필수
      if (!data.scopeTargetIds || data.scopeTargetIds.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${data.scopeType} scope requires non-empty scopeTargetIds`,
          path: ['scopeTargetIds'],
        });
      }
    }

    // Operation 검증
    if (data.operationType === 'scale' && data.operationValue < -1000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'scale operationValue must be >= -1000',
        path: ['operationValue'],
      });
    }

    if (data.operationType === 'override' && data.operationValue <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'override operationValue must be positive',
        path: ['operationValue'],
      });
    }

    // Layer별 minQuantity 검증
    if (data.layer === 'tiered_price') {
      if (!data.minQuantity || data.minQuantity <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'tiered_price layer requires positive minQuantity',
          path: ['minQuantity'],
        });
      }
    } else {
      if (data.minQuantity !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${data.layer} layer should not have minQuantity`,
          path: ['minQuantity'],
        });
      }
    }
  });

// Layer별 스키마 (타입 추론을 위해 분리)
export const basePriceRuleSchema = basePricingRuleSchema.refine((data) => data.layer === 'base_price', {
  message: 'Must be base_price layer',
});

export const membershipPriceRuleSchema = basePricingRuleSchema.refine((data) => data.layer === 'membership_price', {
  message: 'Must be membership_price layer',
});

export const tieredPriceRuleSchema = basePricingRuleSchema.refine((data) => data.layer === 'tiered_price', {
  message: 'Must be tiered_price layer',
});

// 전체 규칙 union
export const pricingRuleSchema = basePricingRuleSchema;

// 규칙 세트 스키마
export const pricingRulesSetSchema = z
  .object({
    basePriceRules: z.array(basePriceRuleSchema),
    membershipPriceRules: z.array(membershipPriceRuleSchema),
    tieredPriceRules: z.array(tieredPriceRuleSchema),
  })
  .refine(
    (data) => {
      if (data.basePriceRules.length === 0) {
        return false;
      }
      const firstRule = data.basePriceRules.find((r) => r.order === 1);
      return firstRule?.scopeType === 'all_variants';
    },
    {
      message: 'First base_price rule (order=1) must have scopeType all_variants',
      path: ['basePriceRules'],
    },
  )
  .refine(
    (data) => {
      const checkDuplicates = (rules: Array<{ order: number }>) => {
        const orders = rules.map((r) => r.order);
        return orders.length === new Set(orders).size;
      };
      return (
        checkDuplicates(data.basePriceRules) &&
        checkDuplicates(data.membershipPriceRules) &&
        checkDuplicates(data.tieredPriceRules)
      );
    },
    {
      message: 'Duplicate order values found within a layer',
    },
  );

// ============================================================================
// TypeScript 타입 정의 (Zod infer 기반)
// ============================================================================

// Zod에서 추출한 기본 타입 (런타임 검증 통과 타입)
type PricingRuleBase = z.infer<typeof basePricingRuleSchema>;

// Zod 검증된 타입 그대로 export (런타임 검증과 일치)
export type BasePriceRule = PricingRuleBase;
export type MembershipPriceRule = PricingRuleBase;
export type TieredPriceRule = PricingRuleBase;
export type PricingRuleInput = PricingRuleBase;

// 규칙 세트 타입 (Zod infer와 일치)
export type PricingRulesSetInput = z.infer<typeof pricingRulesSetSchema>;

// ============================================================================
// TypeScript 타입 좁히기 (Type Narrowing)
// ============================================================================

// Scope 타입 좁히기
export type AllVariantsScope = {
  scopeType: 'all_variants';
  scopeTargetIds?: undefined;
};

export type WithOptionScope = {
  scopeType: 'with_option';
  scopeTargetIds: string[];
};

export type VariantsScope = {
  scopeType: 'variants';
  scopeTargetIds: string[];
};

// Operation 타입 좁히기
export type OffsetOperation = {
  operationType: 'offset';
  operationValue: number;
};

export type ScaleOperation = {
  operationType: 'scale';
  operationValue: number; // >= -1000
};

export type OverrideOperation = {
  operationType: 'override';
  operationValue: number; // > 0
};

// 정밀한 Layer별 타입 (type guard로 좁힌 후 사용)
export type NarrowedBasePriceRule = {
  layer: 'base_price';
  order: number;
  minQuantity?: undefined;
} & (AllVariantsScope | WithOptionScope | VariantsScope) &
  (OffsetOperation | ScaleOperation | OverrideOperation);

export type NarrowedMembershipPriceRule = {
  layer: 'membership_price';
  order: number;
  minQuantity?: undefined;
} & (AllVariantsScope | WithOptionScope | VariantsScope) &
  (OffsetOperation | ScaleOperation | OverrideOperation);

export type NarrowedTieredPriceRule = {
  layer: 'tiered_price';
  order: number;
  minQuantity: number;
} & (AllVariantsScope | WithOptionScope | VariantsScope) &
  (OffsetOperation | ScaleOperation | OverrideOperation);

// ============================================================================
// TypeScript Type Guards (타입 좁히기용)
// ============================================================================

// Layer type guards
export function isBasePriceRule(rule: PricingRuleInput): rule is NarrowedBasePriceRule {
  return rule.layer === 'base_price';
}

export function isMembershipPriceRule(rule: PricingRuleInput): rule is NarrowedMembershipPriceRule {
  return rule.layer === 'membership_price';
}

export function isTieredPriceRule(rule: PricingRuleInput): rule is NarrowedTieredPriceRule {
  return rule.layer === 'tiered_price';
}

// Scope type guards
export function hasAllVariantsScope(rule: PricingRuleInput): rule is PricingRuleInput & AllVariantsScope {
  return rule.scopeType === 'all_variants';
}

export function hasWithOptionScope(rule: PricingRuleInput): rule is PricingRuleInput & WithOptionScope {
  return rule.scopeType === 'with_option';
}

export function hasVariantsScope(rule: PricingRuleInput): rule is PricingRuleInput & VariantsScope {
  return rule.scopeType === 'variants';
}

// Operation type guards
export function hasOffsetOperation(rule: PricingRuleInput): rule is PricingRuleInput & OffsetOperation {
  return rule.operationType === 'offset';
}

export function hasScaleOperation(rule: PricingRuleInput): rule is PricingRuleInput & ScaleOperation {
  return rule.operationType === 'scale';
}

export function hasOverrideOperation(rule: PricingRuleInput): rule is PricingRuleInput & OverrideOperation {
  return rule.operationType === 'override';
}

// ============================================================================
// 유틸리티 헬퍼 (조합 type guard)
// ============================================================================

// 특정 조합 체크 예시
export function isBaseOffsetRule(rule: PricingRuleInput): rule is NarrowedBasePriceRule & OffsetOperation {
  return isBasePriceRule(rule) && hasOffsetOperation(rule);
}

export function hasScopeTargets(rule: PricingRuleInput): rule is PricingRuleInput & (WithOptionScope | VariantsScope) {
  return rule.scopeType !== 'all_variants';
}
