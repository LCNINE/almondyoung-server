import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * K7 PR3 — 상자 전 수요 취소(`UnboxedDemandCancellation`)는 판매주문 취소가 부르는 내부 단계다.
 * FO·FOI 의 canceledQty·상태를 다른 길로 쓰기 시작하면 투영 없이 FO 상태가 갈린다.
 * 스펙·`__support__`·`__fixtures__` 는 테스트 데이터를 만들 뿐이라 대상이 아니다.
 */
const ROOT = join(__dirname, '../../../../../..');
const SRC = join(ROOT, 'apps/core/src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === '__support__' || name === '__fixtures__' ? [] : walk(path);
    }
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

function filesCalling(pattern: RegExp): string[] {
  return walk(SRC)
    .filter((path) => pattern.test(readFileSync(path, 'utf8')))
    .map((path) => relative(ROOT, path))
    .sort();
}

describe('UnboxedDemandCancellation 호출자', () => {
  it('UnboxedDemandCancellation 은 판매주문 상자 전 취소만 부른다', () => {
    expect(filesCalling(/\bunboxedDemand\.(reduce|cancelOrder|lockForCancellation)\(/)).toEqual([
      'apps/core/src/modules/sales-order/services/sales-orders.service.ts',
    ]);
  });
});
