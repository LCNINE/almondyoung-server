import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * K3 — FO·FOI status 는 투영(`reprojectFulfillmentOrders`)만 쓴다. 다른 곳이 status 를 쓰면 «수량 사실과 상태가 갈리는»
 * 두 번째 모델이 생긴다(감사 §4.3). 허용 목록은 줄어드는 방향으로만 바뀐다.
 * 스펙·`__support__`·`__fixtures__` 는 테스트 데이터를 만들 뿐이라 대상이 아니다.
 */
const ROOT = join(__dirname, '../../../../../..');
const SRC = join(ROOT, 'apps/core/src');

function walk(path: string): string[] {
  if (statSync(path).isDirectory()) {
    return readdirSync(path).flatMap((name) =>
      name === '__support__' || name === '__fixtures__' ? [] : walk(join(path, name)),
    );
  }
  return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
}

const T = '(?:fulfillmentOrders|fulfillmentOrderItems)';
const STATUS_WRITE = new RegExp(
  [
    // drizzle 직접 형: .update(wmsTables.fulfillmentOrders).set({ … status … })
    String.raw`\.update\((?:wmsTables|inventoryTables)\.${T}\)\s*\.set\(\{[^}]*\bstatus\b\s*[:,}]`,
    // drizzle 별칭 형: const t = wmsTables.fulfillmentOrders; … .update(t).set({ status … })
    String.raw`const (\w+) = (?:wmsTables|inventoryTables)\.${T};[\s\S]*?\.update\(\1\)\s*\.set\(\{[^}]*\bstatus\b\s*[:,}]`,
    // raw SQL 리터럴 형
    String.raw`\bupdate\s+"?(?:fulfillment_orders|fulfillment_order_items)"?\s+set\b[^;]*\bstatus\b`,
    // raw SQL 보간 형: sql`UPDATE ${wmsTables.fulfillmentOrders} SET status …`
    String.raw`\bupdate\s+\$\{\s*(?:wmsTables|inventoryTables)\.${T}\s*\}\s+set\b[^;]*\bstatus\b`,
  ].join('|'),
  'i',
);

describe('FO·FOI status 쓰기 (K3)', () => {
  it('패턴이 살아 있다', () => {
    expect(STATUS_WRITE.test(".update(wmsTables.fulfillmentOrders)\n  .set({ status: 'x' })")).toBe(true);
    expect(STATUS_WRITE.test('.update(wmsTables.fulfillmentOrderItems).set({ canceledQty, status })')).toBe(true);
    expect(STATUS_WRITE.test("sql`UPDATE ${wmsTables.fulfillmentOrderItems} SET status = 'x'`")).toBe(true);
    expect(STATUS_WRITE.test("UPDATE fulfillment_orders SET status = 'x'")).toBe(true);
    expect(STATUS_WRITE.test('.update(wmsTables.fulfillmentOrders).set({ shippedAt: now })')).toBe(false);
  });

  it('status 를 쓰는 파일은 투영 하나와 옛 직배 하나뿐', () => {
    const writers = walk(SRC)
      .filter((path) => STATUS_WRITE.test(readFileSync(path, 'utf8')))
      .map((path) => relative(ROOT, path))
      .sort();
    expect(writers).toEqual([
      'apps/core/src/modules/fulfillment/fulfillment-order/fulfillment-order-projection.ts',
      // 옛 직배 — 생성 'ready' 는 K3 PR 4, ship() 'shipped' 는 PR 5·8 이 걷는다. 줄어드는 방향만.
      'apps/core/src/modules/fulfillment/services/fulfillments.service.ts',
    ]);
  });
});
