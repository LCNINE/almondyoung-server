import { model } from '@medusajs/framework/utils';

const PromotionMeta = model
  .define(
    { name: 'PromotionMeta', tableName: 'promotion_meta' },
    {
      id: model.id().primaryKey(),
      promotion_id: model.text(),
      name: model.text().nullable(),
      max_discount_amount: model.number().nullable(),
      created_by: model.text().nullable(),
      visibility: model.text().default('public').nullable(),
      max_claims: model.number().nullable(),
      issued_count: model.number().default(0),
      auto_issue_trigger: model.text().nullable(),
    },
  )
  .indexes([
    { on: ['promotion_id'], name: 'idx_promotion_meta_promotion_id', unique: true },
  ]);

export default PromotionMeta;
