import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

// 이 spec 은 modules/inventory 루트에 위치 → __dirname 이 스캔 루트
const INVENTORY_ROOT = __dirname;
const ALLOW_FILES = new Set(['stock-event.store.ts']); // 유일한 정상 원장 writer

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectTsFiles(full));
      continue;
    }
    if (!entry.endsWith('.ts')) continue;
    if (entry.endsWith('.spec.ts')) continue; // 테스트 픽스처 제외
    if (ALLOW_FILES.has(entry)) continue;
    out.push(full);
  }
  return out;
}

const FORBIDDEN = [
  /\.insert\(\s*(wmsTables\.)?stockEvents\b/,
  /\.insert\(\s*(wmsTables\.)?stockLedgers\b/,
  /\.update\(\s*(wmsTables\.)?stockLedgers\b/,
];

describe('inventory write boundary (arch)', () => {
  it('StockEventStore 외부에서 stockEvents/stockLedgers 직접 쓰기 금지', () => {
    const violations: string[] = [];
    for (const file of collectTsFiles(INVENTORY_ROOT)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (FORBIDDEN.some((re) => re.test(line))) violations.push(`${file}:${i + 1}  ${line.trim()}`);
        });
    }
    expect(violations).toEqual([]);
  });
});
