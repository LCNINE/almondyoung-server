import { model } from '@medusajs/framework/utils';

// 쿠폰 이벤트에 담긴 개별 쿠폰(프로모션). 정렬 순서 유지.
const CouponEventItem = model
  .define(
    { name: 'CouponEventItem', tableName: 'coupon_event_item' },
    {
      id: model.id().primaryKey(),
      event_id: model.text(),
      promotion_id: model.text(),
      sort_order: model.number().default(0),
    },
  )
  .indexes([
    // 주의: 실제 DB 인덱스는 마이그레이션에서 PARTIAL(`WHERE deleted_at IS NULL`)로 생성된다.
    { on: ['event_id', 'promotion_id'], name: 'idx_coupon_event_item_unique', unique: true },
    { on: ['event_id'], name: 'idx_coupon_event_item_event_id' },
  ]);

export default CouponEventItem;
