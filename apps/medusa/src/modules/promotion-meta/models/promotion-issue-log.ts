import { model } from '@medusajs/framework/utils';

const PromotionIssueLog = model
  .define(
    { name: 'PromotionIssueLog', tableName: 'promotion_issue_log' },
    {
      id: model.id().primaryKey(),
      customer_id: model.text(),
      promotion_id: model.text(),
      trigger: model.text(),
    },
  )
  .indexes([
    // 주의: 실제 DB 인덱스는 마이그레이션에서 PARTIAL(`WHERE deleted_at IS NULL`)로 생성된다.
    // 회수 시 removeIssueLog 가 soft-delete 하고, 재발급(recordIssue/isAlreadyIssued)이
    // 이 partial 조건 덕에 재삽입 가능하다. 스키마 재생성 시 `WHERE deleted_at IS NULL` 을
    // 반드시 보존해야 한다(full unique 로 바뀌면 회수 후 재발급이 깨진다).
    { on: ['customer_id', 'promotion_id'], name: 'idx_promotion_issue_log_unique', unique: true },
  ]);

export default PromotionIssueLog;
