import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 스토어프론트가 core 의 고객 주문 상태 값을 전부 아는지 대조한다 (K6 PR5 · 결함 F1).
 *
 * core 는 2026-07-19 부터 `fulfillmentStatus` 로 `preparing`·`shipping` 을 보냈는데 스토어프론트 타입·라벨표는
 * 옛 FO 상태값에 머물러, 준비·배송 중 주문이 석 달 동안 «결제 완료»로 보였다. `web/**` 은 CI 워크플로가 없고
 * 루트 `type-check` 도 `web` 을 제외하므로 이 spec(루트 jest)이 두 트리를 잇는 유일한 게이트다.
 *
 * core `store-order-actions.dto.ts` 에 값을 더했으면 같은 PR 에서 스토어프론트 `store-orders.ts` 와
 * 라벨표(`order-status-display.ts`·`order-status-badges.tsx`)도 고친다.
 *
 * `StoreFulfillmentStatus` 만 «같은 집합»이다 — 스토어프론트에 옛 값이 남으면 라벨표가 그 값을 기준으로 짜이고,
 * F1 이 정확히 그것이었다. 나머지는 스토어프론트가 먼저 아는 값(예: `cancel_requested`)이 있어 core ⊆ 스토어프론트.
 */
const REPO = join(__dirname, '..', '..', '..', '..', '..', '..');
const CORE_DTO = 'apps/core/src/modules/sales-order/dto/store-order-actions.dto.ts';
const STOREFRONT_TYPES = 'web/almondyoung-storefront/src/lib/api/orders/store-orders.ts';

/**
 * `export type <typeName> =` 의 문자열 리터럴 유니온을 읽는다. 유니온은 `=` 줄과 그 뒤의 `|`·주석·리터럴로 시작하는
 * 줄까지다. 못 찾거나 0개면 throw — 빈 집합은 «⊆ 무엇이든»이라 가드가 조용히 초록이 된다.
 */
function readStringUnion(source: string, typeName: string): string[] {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => new RegExp(`^export type ${typeName}\\s*=`).test(line));
  if (start < 0) throw new Error(`export type ${typeName} 를 찾지 못했다`);
  const body = [lines[start].slice(lines[start].indexOf('=') + 1)];
  for (const line of lines.slice(start + 1)) {
    if (!/^\s*(\||\/\/|'|")/.test(line)) break;
    body.push(line);
  }
  const literals = body
    .map((line) => line.replace(/\/\/.*$/, ''))
    .flatMap((line) => [...line.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2]));
  if (literals.length === 0) throw new Error(`${typeName} 에서 문자열 리터럴을 하나도 읽지 못했다`);
  return literals;
}

const read = (relative: string) => readFileSync(join(REPO, relative), 'utf8');
const core = (typeName: string) => readStringUnion(read(CORE_DTO), typeName);
const storefront = (typeName: string) => readStringUnion(read(STOREFRONT_TYPES), typeName);

describe('readStringUnion — 가드가 빈 집합으로 조용히 통과하지 않는다', () => {
  it('core 모양(작은따옴표·줄 주석·세미콜론)을 읽는다', () => {
    expect(readStringUnion("export type X =\n  | 'a' // 주석\n  | 'b'; // 끝\n\nexport type Y = 'z';", 'X')).toEqual([
      'a',
      'b',
    ]);
  });
  it('스토어프론트 모양(큰따옴표·세미콜론 없음·줄 주석 줄)을 읽는다', () => {
    expect(readStringUnion('export type X =\n  | "a"\n  // 설명\n  | "b"\n\nexport interface Z {}', 'X')).toEqual([
      'a',
      'b',
    ]);
  });
  it('한 줄 유니온을 읽는다', () => {
    expect(readStringUnion("export type X = 'a' | 'b';", 'X')).toEqual(['a', 'b']);
  });
  it('타입이 없으면 throw', () => {
    expect(() => readStringUnion("export type Y = 'a';", 'X')).toThrow();
  });
  it('문자열 리터럴이 0개면 throw', () => {
    expect(() => readStringUnion('export type X = string;', 'X')).toThrow();
  });
});

describe('스토어프론트 store-orders.ts 는 core 가 보내는 값을 전부 안다 (K6 PR5 · F1)', () => {
  it('StoreFulfillmentStatus 는 같은 집합이다 — 라벨표가 옛 FO 상태값에 머물면 «배송 중»이 «결제 완료»로 보인다', () => {
    expect([...storefront('StoreFulfillmentStatus')].sort()).toEqual([...core('StoreFulfillmentStatus')].sort());
  });
  it.each(['StoreOrderAction', 'StoreRefundStatus', 'StoreCancelUnavailableReason', 'StoreClaimStatus'])(
    '%s — core 값은 스토어프론트에도 있다(스토어프론트만 아는 값은 허용)',
    (typeName) => {
      const known = new Set(storefront(typeName));
      expect(core(typeName).filter((value) => !known.has(value))).toEqual([]);
    },
  );
});
