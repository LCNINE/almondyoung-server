import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * K6 PR4(D1) — 상자 미처리분 취소(`ShipmentPlanningService.cancelOutstanding`)는 판매주문 V2 취소가 부르는
 * 내부 단계다. 운영자 HTTP 라우트(`POST /shipments/:id/cancellations`)가 SO 기록·환불·이벤트 없이 상자에서만
 * 빼던 길(F5)을 지웠으니, 다른 호출자가 생기면 같은 구멍이 다시 열린다.
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

describe('cancelOutstanding 호출자', () => {
  it('cancelOutstanding 은 판매주문 취소만 부른다 — 운영자 라우트가 되살아나면 빨갛다 (K6 D1)', () => {
    expect(filesCalling(/\.cancelOutstanding\(/)).toEqual([
      'apps/core/src/modules/sales-order/services/sales-orders.service.ts',
    ]);
  });
});
