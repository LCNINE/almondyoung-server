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
      // 유효기간 «정책 축» (#488 결정 1). 인스턴스 축은 customer↔promotion 링크 행의 expires_at 이다.
      // claimable/assigned_only 에겐 발급 가능 구간, public 에겐 사용 가능 구간으로 읽힌다.
      starts_at: model.dateTime().nullable(),
      ends_at: model.dateTime().nullable(),
      /** 발급일 + N일. null 이면 만료는 ends_at 이 정한다. */
      validity_days: model.number().nullable(),
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
