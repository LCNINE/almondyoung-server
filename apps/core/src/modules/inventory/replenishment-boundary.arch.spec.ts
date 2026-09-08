import { readdirSync, readFileSync, statSync } from 'fs';
import { join, sep } from 'path';

const INVENTORY_ROOT = __dirname;
const REPLENISHMENT_DIR = join(INVENTORY_ROOT, 'replenishment');
const PROCUREMENT_DIR = join(INVENTORY_ROOT, 'procurement');

const PROCUREMENT = /(^|\/)procurement(\/|$)/;
const REPLENISHMENT = /(^|\/)replenishment(\/|$)/;
const FRAMEWORK = /^(@nestjs\/|drizzle-orm|@app\/db)/;

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectTsFiles(full));
      continue;
    }
    if (!entry.endsWith('.ts') || entry.endsWith('.spec.ts')) continue;
    out.push(full);
  }
  return out;
}

/**
 * 파일 안의 모든 모듈 지정자: `from '…'` (import·re-export, 줄바꿈 무관) · `require('…')` · `import('…')`.
 * 스펙 §8.2: replenishment 는 procurement 를 import 하지 않고, procurement 도 replenishment 를
 * import 하지 않는다. 제안은 읽기 전용이고 실행은 화면이 기존 API 로 한다. 첫 위반이 생기면
 * 이 스펙보다 먼저 스펙 문서를 고칠 것.
 */
function moduleSpecifiers(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const specifiers: string[] = [];
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}
describe('replenishment boundary (arch)', () => {
  it('replenishment/ 는 procurement/ 를 import 하지 않는다', () => {
    const violations = collectTsFiles(REPLENISHMENT_DIR).flatMap((file) =>
      moduleSpecifiers(file)
        .filter((s) => PROCUREMENT.test(s))
        .map((s) => `${file}: ${s}`),
    );
    expect(violations).toEqual([]);
  });

  it('procurement/ 는 replenishment/ 를 import 하지 않는다', () => {
    const violations = collectTsFiles(PROCUREMENT_DIR).flatMap((file) =>
      moduleSpecifiers(file)
        .filter((s) => REPLENISHMENT.test(s))
        .map((s) => `${file}: ${s}`),
    );
    expect(violations).toEqual([]);
  });

  it('순수 층(policy/ · suggestion.assembler · suggestion.types · demand/calendar · demand-profile.calculator)은 Nest · drizzle 을 모른다', () => {
    const pure = collectTsFiles(REPLENISHMENT_DIR).filter(
      (file) =>
        file.includes(`${sep}policy${sep}`) ||
        file.endsWith('suggestion.assembler.ts') ||
        file.endsWith('suggestion.types.ts') ||
        file.endsWith(`${sep}demand${sep}calendar.ts`) ||
        file.endsWith('demand-profile.calculator.ts'),
    );
    expect(pure.length).toBeGreaterThanOrEqual(5);
    const violations = pure.flatMap((file) =>
      moduleSpecifiers(file)
        .filter((s) => FRAMEWORK.test(s))
        .map((s) => `${file}: ${s}`),
    );
    expect(violations).toEqual([]);
  });
});
