import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 저녁 맞추기 init 뒤에는 옛 스크립트가 아예 돌지 않아야 한다 (#1304).
 * sync-stock 은 절대값 덮어쓰기라 core 원장을 되돌리고, handover-stock-addback 은 이중 가산이다.
 * main 을 띄우려면 DB 가 필요해서 소스를 읽어, 연결 직후·계획 출력/쓰기보다 앞에서 거절하는지 본다.
 */
const SELLMATE = join(__dirname, '..');

function mainBody(file: string): string {
  const src = readFileSync(join(SELLMATE, file), 'utf8');
  const start = src.indexOf('async function main(');
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf('require.main === module', start);
  return src.slice(start, end);
}

const CASES: { file: string; before: string[] }[] = [
  { file: 'sync-stock.ts', before: ['computePlans(', '.begin(', 'DRY-RUN'] },
  { file: 'handover-stock-addback.ts', before: ['assess(', 'inTransaction(', 'DRY-RUN'] },
];

describe.each(CASES)('$file 는 init 뒤 거절한다', ({ file, before }) => {
  const body = mainBody(file);
  const connect = body.indexOf('postgres(');
  const check = body.indexOf('reconcileInitExists(');

  it('DB 연결 직후 reconcileInitExists 를 부른다', () => {
    expect(connect).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(connect);
  });

  it('SYNC_REFUSAL_AFTER_INIT 로 거절한다', () => {
    const refusal = body.indexOf('SYNC_REFUSAL_AFTER_INIT');
    expect(refusal).toBeGreaterThan(check);
  });

  it.each(before)('거절은 %s 보다 앞이다 (DRY_RUN 에서도)', (marker) => {
    const at = body.indexOf(marker);
    expect(at).toBeGreaterThan(-1);
    expect(check).toBeLessThan(at);
  });

  it('DATABASE_URL 없이 끝나는 우회 경로가 없다', () => {
    expect(body).not.toMatch(/DRY_RUN\s*&&\s*!DATABASE_URL/);
    expect(body).not.toMatch(/!DATABASE_URL\s*&&\s*!DRY_RUN/);
  });
});
