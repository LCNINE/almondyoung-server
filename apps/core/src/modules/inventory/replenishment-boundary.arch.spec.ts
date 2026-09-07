import { readdirSync, readFileSync, statSync } from 'fs';
import { join, sep } from 'path';

const INVENTORY_ROOT = __dirname;
const REPLENISHMENT = join(INVENTORY_ROOT, 'replenishment');
const PROCUREMENT = join(INVENTORY_ROOT, 'procurement');

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

function importLines(file: string): string[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => /^\s*import\s/.test(line) || /\brequire\(/.test(line));
}

/**
 * 스펙 §8.2: replenishment 는 procurement 를 import 하지 않고, procurement 도 replenishment 를
 * import 하지 않는다. 제안은 읽기 전용이고 실행은 화면이 기존 API 로 한다. 첫 위반이 생기면
 * 이 스펙보다 먼저 스펙 문서를 고칠 것.
 */
describe('replenishment boundary (arch)', () => {
  it('replenishment/ 는 procurement/ 를 import 하지 않는다', () => {
    const violations = collectTsFiles(REPLENISHMENT).flatMap((file) =>
      importLines(file)
        .filter((line) => /\/procurement\//.test(line) || /['"]\.\.\/procurement/.test(line))
        .map((line) => `${file}: ${line.trim()}`),
    );
    expect(violations).toEqual([]);
  });

  it('procurement/ 는 replenishment/ 를 import 하지 않는다', () => {
    const violations = collectTsFiles(PROCUREMENT).flatMap((file) =>
      importLines(file)
        .filter((line) => /\/replenishment\//.test(line) || /['"]\.\.\/replenishment/.test(line))
        .map((line) => `${file}: ${line.trim()}`),
    );
    expect(violations).toEqual([]);
  });

  it('순수 층(policy/ · suggestion.assembler · suggestion.types)은 Nest · drizzle 을 모른다', () => {
    const pure = collectTsFiles(REPLENISHMENT).filter(
      (file) =>
        file.includes(`${sep}policy${sep}`) ||
        file.endsWith('suggestion.assembler.ts') ||
        file.endsWith('suggestion.types.ts'),
    );
    expect(pure.length).toBeGreaterThan(0);
    const violations = pure.flatMap((file) =>
      importLines(file)
        .filter((line) => /@nestjs\//.test(line) || /drizzle-orm/.test(line) || /@app\/db/.test(line))
        .map((line) => `${file}: ${line.trim()}`),
    );
    expect(violations).toEqual([]);
  });
});
