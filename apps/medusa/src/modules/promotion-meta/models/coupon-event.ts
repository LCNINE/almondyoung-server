import { model } from '@medusajs/framework/utils';

// 쿠폰 이벤트 — 배너 하나에 여러 쿠폰을 묶어 발급받게 하는 마케팅 단위.
// 예산/기간 로직을 갖는 캠페인과 별개. (담긴 쿠폰은 CouponEventItem 으로 연결)
const CouponEvent = model
  .define(
    { name: 'CouponEvent', tableName: 'coupon_event' },
    {
      id: model.id().primaryKey(),
      slug: model.text(),
      title: model.text(),
      description: model.text().nullable(),
      banner_image_url: model.text().nullable(),
      starts_at: model.dateTime().nullable(),
      ends_at: model.dateTime().nullable(),
      status: model.text().default('draft'), // draft | active | ended
    },
  )
  .indexes([
    // 주의: 실제 DB 인덱스는 마이그레이션에서 PARTIAL(`WHERE deleted_at IS NULL`)로 생성된다.
    { on: ['slug'], name: 'idx_coupon_event_slug', unique: true },
  ]);

export default CouponEvent;
