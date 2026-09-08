import { readdirSync, readFileSync, statSync } from 'fs';
import { join, sep } from 'path';

const INVENTORY_ROOT = join(__dirname, '..');

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'schema') continue; // 컬럼 정의 자체는 contract PR 까지 남는다
      out.push(...collectTsFiles(full));
      continue;
    }
    if (!entry.endsWith('.ts') || entry.endsWith('.spec.ts')) continue;
    out.push(full);
  }
  return out;
}

/**
 * #743 B: skus.safety_stock 은 코드가 더 이상 읽지 않는다(스펙 §6 「거취」, column drop 1단계).
 * 이 스펙이 초록인 채 배포 한 번이 지나면 contract PR 이 DROP COLUMN 을 낸다.
 * 보충 제안의 안전재고는 규칙(replenishment_sku_overrides.safety_stock)과 정책 계산이다 — 이름이 같아도 다른 컬럼.
 */
describe('skus.safety_stock 참조 0 (arch)', () => {
  it('inventory/ 소스(schema/ 제외)에 skus.safetyStock · safety_stock 참조가 없다', () => {
    const offenders = collectTsFiles(INVENTORY_ROOT).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      const hits: string[] = [];
      if (/skus\.safetyStock|skus\.safety_stock|wmsTables\.skus\.safetyStock/.test(source)) hits.push(`${file}: skus.safety_stock 참조`);
      if (file.includes(`${sep}sku-catalog${sep}`) || file.includes(`${sep}sku-group${sep}`)) {
        if (/\bsafetyStock\b/.test(source)) hits.push(`${file}: safetyStock 필드`);
      }
      return hits;
    });
    expect(offenders).toEqual([]);
  });
});
