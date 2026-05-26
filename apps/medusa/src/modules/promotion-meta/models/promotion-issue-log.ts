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
    { on: ['customer_id', 'promotion_id'], name: 'idx_promotion_issue_log_unique', unique: true },
  ]);

export default PromotionIssueLog;
