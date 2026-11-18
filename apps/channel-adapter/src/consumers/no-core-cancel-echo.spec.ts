import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * ADR-0042 · #1016 35번 PR-D — core 의 취소를 Medusa 로 되돌려 쓰던 역투영은 «이미 취소됨» 메아리만 냈고 지웠다.
 * 다시 생기지 않게 소스 전체를 훑는다. (원래 `fulfillment-events.consumer.spec.ts` 에 있었고, 그 소비자를
 * #1452 에서 지우면서 이 파일로 옮겼다 — 이 가드는 그 소비자와 무관하다.)
 */
describe('channel-adapter 는 core 의 SalesOrderCancelled 를 구독하지 않는다', () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
    });
  }

  const srcRoot = join(__dirname, '..');

  it('어느 소스도 SalesOrderCancelled 를 핸들러로 걸지 않는다', () => {
    const offenders = sourceFiles(srcRoot).filter((file) => /'SalesOrderCancelled'/.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('CoreOrderCancelled 인박스 행을 적재하는 소스가 없다', () => {
    const offenders = sourceFiles(srcRoot).filter((file) =>
      /eventType:\s*'CoreOrderCancelled'/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
