import { execFileSync } from 'child_process';
import * as path from 'path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { reviews } from '../db/schema';
import { ADMIN_MANUAL_SOURCE_SYSTEM, isLegacySource, isOwnSource, OWN_SOURCE_SYSTEM } from '../source-system';

/**
 * 「자체 작성인가」의 정의가 여러 파일로 복제되는 것을 막는다.
 *
 * 이 값은 한때 여섯 곳에 리터럴로 흩어져 있었다(목록 쿼리·베스트 선정·권한 발급·스키마 기본값·통계).
 * 흩어진 정의는 한 곳만 고쳐도 나머지가 조용히 옛 뜻으로 남고, 그 나머지가 세는 쿼리면
 * 화면 숫자만 틀린 채 오류도 로그도 남지 않는다.
 */
describe('출처 판정의 정본', () => {
  const appRoot = path.resolve(__dirname, '..');
  const canonicalFile = path.join(appRoot, 'source-system.ts');

  const hitsOutsideCanonical = (literal: string) =>
    execFileSync('grep', ['-rn', '--include=*.ts', `'${literal}'`, appRoot], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .filter((line) => !line.startsWith(`${canonicalFile}:`))
      .filter((line) => !/\.spec\.ts:/.test(line));

  it("'almondyoung' 리터럴은 정본 파일 밖의 소스에 없다", () => {
    expect(hitsOutsideCanonical(OWN_SOURCE_SYSTEM)).toEqual([]);
  });

  it("'admin-manual' 리터럴도 정본 파일 밖의 소스에 없다", () => {
    expect(hitsOutsideCanonical(ADMIN_MANUAL_SOURCE_SYSTEM)).toEqual([]);
  });

  it('관리자 수기 출처는 자체 작성이 아니고, 컬럼 길이(30)에 들어간다', () => {
    expect(ADMIN_MANUAL_SOURCE_SYSTEM).not.toBe(OWN_SOURCE_SYSTEM);
    expect(ADMIN_MANUAL_SOURCE_SYSTEM.length).toBeLessThanOrEqual(30);
  });

  it('두 술어는 서로의 여집합이다 — 어느 행도 양쪽에 들거나 어디에도 안 들지 않는다', () => {
    const db = drizzle({} as never);
    const own = db.select().from(reviews).where(isOwnSource(reviews.sourceSystem)).toSQL();
    const legacy = db.select().from(reviews).where(isLegacySource(reviews.sourceSystem)).toSQL();

    expect(own.sql).toContain('=');
    expect(legacy.sql).toContain('<>');
    expect(own.params).toEqual([OWN_SOURCE_SYSTEM]);
    expect(legacy.params).toEqual([OWN_SOURCE_SYSTEM]);
  });
});
