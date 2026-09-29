import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = join(__dirname, '../../../../../../..'); // 저장소 루트
const SRC = join(ROOT, 'apps/core/src');
// 스키마 정의와, 스키마 제약을 이름으로 검사하는 스펙만 예외다. PR 2 에서 스키마째 사라진다.
const ALLOWED = new Set([
  'apps/core/src/modules/inventory/schema/inventory.schema.ts',
  'apps/core/src/modules/inventory/schema/outbound-v2-schema.integration.spec.ts',
  'apps/core/src/modules/fulfillment/picking/allocation/no-picking-plan-references.spec.ts',
]);
const PATTERN = /wmsTables\.pickingPlans\b|wmsTables\.pickingPlanMembers\b|pickingSourceAllocations\.planId\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith('.ts')) out.push(path);
  }
  return out;
}

describe('피킹 계획 테이블은 코드에서 사라졌다 (ADR-0041)', () => {
  it('스키마 외에 picking_plans·picking_plan_members·allocations.plan_id 를 참조하는 파일이 없다', () => {
    const offenders = walk(SRC)
      .map((path) => relative(ROOT, path))
      .filter((path) => !ALLOWED.has(path))
      .filter((path) => PATTERN.test(readFileSync(join(ROOT, path), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
