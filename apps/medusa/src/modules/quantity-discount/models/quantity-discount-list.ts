import { model } from '@medusajs/framework/utils';

/**
 * 수량 할인 가격표 하나의 정체(종류·최소수량·기간). 가격은 링크된 price list 에 있다.
 * 같은 기간의 상품끼리 리스트를 함께 쓰므로 (audience, min_quantity, period_key) 가 유일하다.
 * 제목은 사람이 보는 이름이고 찾는 데 쓰지 않는다.
 */
const QuantityDiscountList = model
  .define(
    { name: 'QuantityDiscountList', tableName: 'quantity_discount_list' },
    {
      id: model.id({ prefix: 'qdlist' }).primaryKey(),
      audience: model.enum(['general', 'membership']),
      min_quantity: model.number(),
      // 'always' 또는 KST 날짜 `YYYYMMDD-YYYYMMDD`(열린 쪽은 open)
      period_key: model.text(),
      starts_at: model.dateTime().nullable(),
      ends_at: model.dateTime().nullable(),
    },
  )
  .indexes([
    {
      on: ['audience', 'min_quantity', 'period_key'],
      unique: true,
      where: 'deleted_at IS NULL',
    },
  ]);

export default QuantityDiscountList;
