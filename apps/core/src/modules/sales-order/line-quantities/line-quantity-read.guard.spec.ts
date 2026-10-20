import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * K6 PR2a — 취소 수량은 «취소 라인 행(`sales_order_cancellation_lines`)» 한 곳에서, 읽는 문의 SQL 조각 한 벌로만 읽는다.
 * 쓰기 문(`record-cancellation.ts`)과 조각(`line-quantities.sql.ts`) 말고 이 테이블 이름을 쓰는 파일이 생기면
 * 정의가 다시 여러 벌이 된다. 옛 `metadata.cancelledLines` 파서의 이름이 되살아나는 것도 막는다.
 * 스펙·`__support__`·`__fixtures__` 는 테스트 데이터를 만들 뿐이라 대상이 아니다.
 */
const ROOT = join(__dirname, '../../../../../..');
const SRC = join(ROOT, 'apps/core/src');
const RECORDER = 'apps/core/src/modules/sales-order/cancellation-record/record-cancellation.ts';
const FRAGMENTS = 'apps/core/src/modules/sales-order/line-quantities/line-quantities.sql.ts';
const PARTIAL_PARSER = 'apps/core/src/modules/product-matching/line-composition/partial-cancellation.ts';
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

describe('취소 수량 읽는 문', () => {
  it('only the line-quantity kernel and the recorder read cancellation lines', () => {
    expect(filesMatching((source) => /salesOrderCancellationLines/.test(source))).toEqual([RECORDER, FRAGMENTS]);
  });

  it('retired cancelled-quantity parsers stay gone', () => {
    const pattern = /\bcancelledQuantitySql\b|\bloadPriorPartialCancellationContext\b|\bgetCancelledQuantityByLine\b/;
    expect(filesMatching((source) => pattern.test(source))).toEqual([]);
  });

  it('sumCancelledByLine stays with the recorder', () => {
    // PR 6 (contract) 이 쓰기 문의 백필 전 대비와 함께 둘 다 지운다.
    expect(filesMatching((source) => /\bsumCancelledByLine\b/.test(source))).toEqual([RECORDER, PARTIAL_PARSER].sort());
  });
});
