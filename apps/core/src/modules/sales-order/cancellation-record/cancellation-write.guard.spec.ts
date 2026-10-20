import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * K6 PR1 — 판매주문 취소 기록(`sales_order_cancellations`)과 취소 라인 기록(`sales_order_cancellation_lines`)은
 * 쓰기 문 하나(`record-cancellation.ts`)만 INSERT 한다. 취소 행과 라인 행이 같은 트랜잭션에 함께 쓰이는 것은
 * 그 한 문이 지키는 약속이라, 다른 곳이 직접 INSERT 하면 라인 없는 취소 행이 다시 생긴다.
 * 스펙·`__support__`·`__fixtures__` 는 테스트 데이터를 만들 뿐이라 대상이 아니다.
 */
const ROOT = join(__dirname, '../../../../../..');
const SRC = join(ROOT, 'apps/core/src');
const RECORDER = 'apps/core/src/modules/sales-order/cancellation-record/record-cancellation.ts';
const SCHEMA_FILE = 'inventory.schema.ts';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === '__support__' || name === '__fixtures__' ? [] : walk(path);
    }
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

function filesMatching(predicate: (source: string) => boolean): string[] {
  return walk(SRC)
    .filter((path) => !path.endsWith(SCHEMA_FILE))
    .filter((path) => predicate(readFileSync(path, 'utf8')))
    .map((path) => relative(ROOT, path))
    .sort();
}

describe('취소 기록 쓰기 문', () => {
  it('only the recorder inserts cancellations', () => {
    const pattern = /insert\(\s*wmsTables\.salesOrderCancellations\s*\)/;
    expect(filesMatching((source) => pattern.test(source))).toEqual([RECORDER]);
  });

  it('only the recorder inserts cancellation lines', () => {
    expect(filesMatching((source) => /salesOrderCancellationLines/.test(source) && /insert\(/.test(source))).toEqual([
      RECORDER,
    ]);
  });
});
