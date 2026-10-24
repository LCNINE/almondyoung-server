import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * K7 PR5 — 직배 파트너 취소 대기 행(`direct_ship_cancel_notices`)을 쓰는 길은 정해져 있다: 취소 행은
 * 출고 명령이 FOI 를 줄이는 같은 tx 에서 만들고, 통지 완료 표시는 전용 매니저만 한다. 다른 길이 생기면 취소와
 * 대기 행이 갈린다.
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

describe('직배 파트너 취소 대기 행 쓰기 길', () => {
  it('direct_ship_cancel_notices 는 출고 명령(생성)과 통지 매니저(완료 표시)만 쓴다', () => {
    expect(
      filesCalling(/\.(?:insert|update|delete)\((?:wmsTables|inventoryTables)\.directShipCancelNotices\)/),
    ).toEqual(['apps/core/src/modules/fulfillment/unboxed-demand/unboxed-demand-cancellation.ts']);
  });
});
