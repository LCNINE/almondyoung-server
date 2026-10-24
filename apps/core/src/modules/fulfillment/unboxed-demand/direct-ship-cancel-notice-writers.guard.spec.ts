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
    const T = 'directShipCancelNotices';
    expect(
      filesCalling(
        new RegExp(
          [
            // drizzle 직접 형
            String.raw`\.(?:update|insert|delete)\((?:wmsTables|inventoryTables)\.${T}\)`,
            // drizzle 별칭 형: const n = wmsTables.directShipCancelNotices; … .update(n)
            String.raw`const (\w+) = (?:wmsTables|inventoryTables)\.${T};[\s\S]*?\.(?:update|insert|delete)\(\1\)`,
            // raw SQL 리터럴 형
            String.raw`\b(?:update|insert\s+into|delete\s+from)\s+"?direct_ship_cancel_notices\b`,
            // raw SQL 보간 형: sql`UPDATE ${wmsTables.directShipCancelNotices} …`
            String.raw`\b(?:update|insert\s+into|delete\s+from)\s+\$\{\s*(?:wmsTables|inventoryTables)\.${T}\s*\}`,
          ].join('|'),
          'i',
        ),
      ),
    ).toEqual([
      'apps/core/src/modules/fulfillment/direct-ship-cancel-notice/direct-ship-cancel-notice.manager.ts',
      'apps/core/src/modules/fulfillment/unboxed-demand/unboxed-demand-cancellation.ts',
    ]);
  });
});
