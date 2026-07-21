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
      visibility: model.text().default('public'),
      max_claims: model.number().nullable(),
      issued_count: model.number().default(0),
      auto_issue_trigger: model.text().nullable(),
    },
  )
  .indexes([
    // 주의: 실제 DB 인덱스는 마이그레이션에서 PARTIAL(`WHERE deleted_at IS NULL`)로 생성된다.
    // DML DSL 이 partial 조건을 표현하지 못해 여기선 full unique 로만 선언된다.
    // soft-delete 후 재생성(deleteByPromotionId → upsert)이 이 partial 조건에 의존하므로,
    // 스키마를 재생성할 때 반드시 `WHERE deleted_at IS NULL` 을 보존해야 한다(full unique 로 바뀌면 재생성이 깨진다).
    { on: ['promotion_id'], name: 'idx_promotion_meta_promotion_id', unique: true },
  ]);

export default PromotionMeta;
