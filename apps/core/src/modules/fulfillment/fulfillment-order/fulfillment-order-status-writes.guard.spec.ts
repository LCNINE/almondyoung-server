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
// .set( 부터 문장 끝(.where( · .returning( · ;)까지 훑는다. `{[^}]*` 로 자르면 sql 템플릿 값의 `${…}` 에서 멈춰
// 그 뒤의 status 를 놓친다. 변수 객체(.set(patch))·전개(...patch)는 정규식으로 못 본다 — 그런 쓰기는 투영 함수로 옮긴다.
const SET_STATUS = String.raw`\.set\((?:(?!\.where\(|\.returning\(|;)[\s\S])*?\bstatus\b\s*[:,}]`;
const ALIAS = String.raw`(?:\s+(?:as\s+)?\w+)?`;
const STATUS_WRITE = new RegExp(
  [
    // drizzle 직접 형: .update(wmsTables.fulfillmentOrders).set({ … status … })
    String.raw`\.update\((?:wmsTables|inventoryTables)\.${T}\)\s*${SET_STATUS}`,
    // drizzle 별칭 형: const t = wmsTables.fulfillmentOrders; … .update(t).set({ status … })
    String.raw`const (\w+) = (?:wmsTables|inventoryTables)\.${T};[\s\S]*?\.update\(\1\)\s*${SET_STATUS}`,
    // raw SQL 리터럴 형(별칭 허용): UPDATE fulfillment_order_items foi SET status …
    String.raw`\bupdate\s+"?(?:fulfillment_orders|fulfillment_order_items)"?${ALIAS}\s+set\b[^;]*?\bstatus\b`,
    // raw SQL 보간 형(별칭 허용): sql`UPDATE ${wmsTables.fulfillmentOrders} AS fo SET status …`
    String.raw`\bupdate\s+\$\{\s*(?:wmsTables|inventoryTables)\.${T}\s*\}${ALIAS}\s+set\b[^;]*?\bstatus\b`,
  ].join('|'),
  'i',
);

describe('FO·FOI status 쓰기 (K3)', () => {
  it('패턴이 살아 있다', () => {
    expect(STATUS_WRITE.test(".update(wmsTables.fulfillmentOrders)\n  .set({ status: 'x' })")).toBe(true);
    expect(STATUS_WRITE.test('.update(wmsTables.fulfillmentOrderItems).set({ canceledQty, status })')).toBe(true);
    expect(STATUS_WRITE.test("sql`UPDATE ${wmsTables.fulfillmentOrderItems} SET status = 'x'`")).toBe(true);
    expect(STATUS_WRITE.test("UPDATE fulfillment_orders SET status = 'x'")).toBe(true);
    // 리뷰 지적: sql 템플릿 값(`${…}` 안의 `}`)이 status 앞에 오는 모양 — shipment-planning·draft-box-amender 의 취소·수정 지점이 이 모양이다
    expect(
      STATUS_WRITE.test(
        ".update(wmsTables.fulfillmentOrderItems)\n  .set({ canceledQty: sql`${wmsTables.fulfillmentOrderItems.canceledQty} + ${n}`, status: 'canceled' })",
      ),
    ).toBe(true);
    // 별칭이 붙은 raw SQL
    expect(STATUS_WRITE.test("UPDATE fulfillment_order_items foi SET status = 'x'")).toBe(true);
    expect(STATUS_WRITE.test("sql`UPDATE ${wmsTables.fulfillmentOrders} AS fo SET status = 'x'`")).toBe(true);
    expect(STATUS_WRITE.test('.update(wmsTables.fulfillmentOrders).set({ shippedAt: now })')).toBe(false);
    expect(
      STATUS_WRITE.test(".update(wmsTables.fulfillmentOrders).set({ shippedAt: now }).where(eq(fo.status, 'ready'))"),
    ).toBe(false);
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
