import { getTableConfig } from 'drizzle-orm/pg-core';
import { reviewEligibilities, reviews } from '../../db/schema';

/**
 * 권한 «딱지»가 표에 앉아 있는지 지킨다.
 *
 * 주문에서 나온 권한만 주문 라인을 갖는다. 운영자가 직접 준 권한에는 라인이 없으므로
 * `order_line_id` 에 걸린 UNIQUE 를 전체 인덱스로 되돌리면 그 권한은 «두 번째 행부터»
 * 들어가지 못한다 — 에러는 발급 시점에 나고 원인은 스키마에 있다.
 */
describe('리뷰 권한 표의 딱지', () => {
  const eligibilities = getTableConfig(reviewEligibilities);

  it('발급 경로(provider)는 기본값 order 로 채워진다', () => {
    const provider = eligibilities.columns.find((c) => c.name === 'provider');

    expect(provider?.notNull).toBe(true);
    expect(provider?.default).toBe('order');
  });

  it('주문 라인은 없을 수 있다 — 운영자가 준 권한에는 주문이 없다', () => {
    const orderLineId = eligibilities.columns.find((c) => c.name === 'order_line_id');

    expect(orderLineId?.notNull).toBe(false);
  });

  it('주문 라인 UNIQUE 는 라인이 있는 행에만 걸린다', () => {
    const unique = eligibilities.indexes.find((i) => i.config.name === 'review_eligibilities_order_line_unique');

    expect(unique?.config.unique).toBe(true);
    expect(unique?.config.where).toBeDefined();
  });

  it('리뷰는 자기를 쓰게 해 준 권한 행을 가리킨다 — 권한 «종류»는 모른다', () => {
    const permissionRef = getTableConfig(reviews).columns.find((c) => c.name === 'review_permission_id');

    // 권한 행 없이 들어온 이관·구 데이터가 있으므로 nullable 이다.
    expect(permissionRef).toBeDefined();
    expect(permissionRef?.notNull).toBe(false);
  });
});
