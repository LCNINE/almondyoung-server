import { z } from 'zod';
import { SaleStatusTypeSchema } from './naver-core.zod';

// =================================================================
// == 1. 상품/재고 관련 Body 스키마
// (from naver-api.zod.ts)
// =================================================================

/**
 * 판매 상태 변경 Body
 */
export const ChangeSaleStatusBodySchema = z.object({
  statusType: SaleStatusTypeSchema,
  saleStartDate: z.iso.datetime().optional(),
  saleEndDate: z.iso.datetime().optional(),
  stockQuantity: z.number().int().max(99999999).optional(),
});
export type ChangeSaleStatusBody = z.infer<typeof ChangeSaleStatusBodySchema>;

// -----------------------------------------------------------------
// -- 옵션 재고 변경 (UpdateOptionStock) 관련 하위 스키마
// -----------------------------------------------------------------

const DiscountMethodSchema = z.object({
  value: z.number().int(),
  unitType: z.enum(['PERCENT', 'WON', 'YEN', 'COUNT']),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

const OptionCombinationStockSchema = z.object({
  id: z.number().int(),
  stockQuantity: z.number().int(),
  price: z.number().int().optional(),
  usable: z.boolean().optional(),
});

const OptionStandardStockSchema = z.object({
  id: z.number().int(),
  stockQuantity: z.number().int(),
  usable: z.boolean().optional(),
});

/**
 * 옵션 재고 변경 Body
 */
export const UpdateOptionStockBodySchema = z.object({
  productSalePrice: z.object({
    salePrice: z.number().int(),
  }),
  immediateDiscountPolicy: z.object({
    discountMethod: DiscountMethodSchema,
  }),
  optionInfo: z.object({
    optionCombinations: z.array(OptionCombinationStockSchema).optional(),
    optionStandards: z.array(OptionStandardStockSchema).optional(),
    useStockManagement: z.boolean(),
  }),
});
export type UpdateOptionStockBody = z.infer<typeof UpdateOptionStockBodySchema>;
