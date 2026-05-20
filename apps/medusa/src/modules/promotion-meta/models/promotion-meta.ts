import { model } from '@medusajs/framework/utils';

const PromotionMeta = model
  .define(
    { name: 'PromotionMeta', tableName: 'promotion_meta' },
    {
      id: model.id().primaryKey(),
      promotion_id: model.text(),
      name: model.text().nullable(),
      max_discount_amount: model.number().nullable(),
      max_uses_per_customer: model.number().nullable(),
      created_by: model.text().nullable(),
    },
  )
  .indexes([
    { on: ['promotion_id'], name: 'idx_promotion_meta_promotion_id', unique: true },
  ]);

export default PromotionMeta;
