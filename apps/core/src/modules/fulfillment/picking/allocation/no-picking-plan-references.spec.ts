import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = join(__dirname, '../../../../../../..'); // 저장소 루트
const SRC = join(ROOT, 'apps/core/src');
const SCRIPTS = join(ROOT, 'scripts');
// 스키마 정의와, 스키마 제약을 이름으로 검사하는 스펙만 예외다. PR 2 에서 스키마째 사라진다.
const ALLOWED = new Set([
  'apps/core/src/modules/inventory/schema/inventory.schema.ts',
  'apps/core/src/modules/inventory/schema/outbound-v2-schema.integration.spec.ts',
  'apps/core/src/modules/fulfillment/picking/allocation/no-picking-plan-references.spec.ts',
  // V2 컷오버 감사가 «V2 전용 테이블에 행이 없다» 를 재는 목록. `tableExists` 로 거른 뒤에만 세므로
  // 테이블이 사라져도 0 으로 읽힐 뿐 깨지지 않는다.
  'scripts/fulfillment-v2/toolkit.ts',
]);
const CODE_PATTERN = /wmsTables\.pickingPlans\b|wmsTables\.pickingPlanMembers\b|pickingSourceAllocations\.planId\b/;
// scripts/ 는 drizzle 대신 날 SQL 로 테이블을 읽는다 — 테이블 이름 자체를 본다.
const RAW_SQL_PATTERN = /\bpicking_plans\b|\bpicking_plan_members\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith('.ts')) out.push(path);
  }
  return out;
}

function offenders(dir: string, patterns: RegExp[]): string[] {
  return walk(dir)
    .map((path) => relative(ROOT, path))
    .filter((path) => !ALLOWED.has(path))
    .filter((path) => {
      const text = readFileSync(join(ROOT, path), 'utf8');
      return patterns.some((pattern) => pattern.test(text));
    });
}

describe('피킹 계획 테이블은 코드에서 사라졌다 (ADR-0041)', () => {
  it('apps/core/src 에서 스키마 외에 picking_plans·picking_plan_members·allocations.plan_id 를 참조하는 파일이 없다', () => {
    expect(offenders(SRC, [CODE_PATTERN])).toEqual([]);
  });

  it('scripts/ 에서 계획 테이블을 drizzle 로도 날 SQL 로도 읽는 파일이 없다', () => {
    expect(offenders(SCRIPTS, [CODE_PATTERN, RAW_SQL_PATTERN])).toEqual([]);
  });
});
