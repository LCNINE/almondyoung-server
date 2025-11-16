import { z } from 'zod';

// 기본 공통 필드
const baseRuleSchema = z.object({
  order: z.number().int().min(1),
});

// scopeType별 discriminated union
const allVariantsScopeSchema = baseRuleSchema.extend({
  scopeType: z.literal('all_variants'),
  scopeTargetIds: z.undefined().optional(),
});

const withOptionScopeSchema = baseRuleSchema.extend({
  scopeType: z.literal('with_option'),
  scopeTargetIds: z.array(z.string().uuid()).min(1),
});

const variantsScopeSchema = baseRuleSchema.extend({
  scopeType: z.literal('variants'),
  scopeTargetIds: z.array(z.string().uuid()).min(1),
});

const scopeSchema = z.discriminatedUnion('scopeType', [
  allVariantsScopeSchema,
  withOptionScopeSchema,
  variantsScopeSchema,
]);

// operationType별 validation
const offsetOperationSchema = z.object({
  operationType: z.literal('offset'),
  operationValue: z.number().int(),
});

const scaleOperationSchema = z.object({
  operationType: z.literal('scale'),
  operationValue: z.number().int().gte(-1000),
});

const overrideOperationSchema = z.object({
  operationType: z.literal('override'),
  operationValue: z.number().int().positive(),
});

const operationSchema = z.discriminatedUnion('operationType', [
  offsetOperationSchema,
  scaleOperationSchema,
  overrideOperationSchema,
]);

// Base Price Rule (minQuantity 없음)
export const basePriceRuleSchema = scopeSchema
  .merge(operationSchema)
  .extend({
    layer: z.literal('base_price'),
    minQuantity: z.undefined().optional(),
  });

// Membership Price Rule (minQuantity 없음)
export const membershipPriceRuleSchema = scopeSchema
  .merge(operationSchema)
  .extend({
    layer: z.literal('membership_price'),
    minQuantity: z.undefined().optional(),
  });

// Tiered Price Rule (minQuantity 필수)
export const tieredPriceRuleSchema = scopeSchema
  .merge(operationSchema)
  .extend({
    layer: z.literal('tiered_price'),
    minQuantity: z.number().int().positive(),
  });

// 전체 규칙 union
export const pricingRuleSchema = z.discriminatedUnion('layer', [
  basePriceRuleSchema,
  membershipPriceRuleSchema,
  tieredPriceRuleSchema,
]);

// 규칙 세트 스키마
export const pricingRulesSetSchema = z
  .object({
    basePriceRules: z.array(basePriceRuleSchema),
    membershipPriceRules: z.array(membershipPriceRuleSchema),
    tieredPriceRules: z.array(tieredPriceRuleSchema),
  })
  .refine(
    (data) => {
      // base_price 첫 규칙은 all_variants여야 함
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
      // 각 레이어 내 order 중복 검사
      const checkDuplicates = (rules: any[]) => {
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

// TypeScript 타입 추출
export type BasePriceRule = z.infer<typeof basePriceRuleSchema>;
export type MembershipPriceRule = z.infer<typeof membershipPriceRuleSchema>;
export type TieredPriceRule = z.infer<typeof tieredPriceRuleSchema>;
export type PricingRuleInput = z.infer<typeof pricingRuleSchema>;
export type PricingRulesSetInput = z.infer<typeof pricingRulesSetSchema>;

