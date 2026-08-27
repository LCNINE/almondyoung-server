import { readdirSync, readFileSync, statSync } from 'fs';
import { basename, join, sep } from 'path';

// 이 spec 은 modules/inventory 루트에 위치 → __dirname 이 스캔 루트
const INVENTORY_ROOT = __dirname;

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
    out.push(full);
  }
  return out;
}

const LEDGER_ALLOW_FILES = new Set(['stock-event.store.ts']); // 유일한 정상 원장 writer

const LEDGER_FORBIDDEN = [
  /\.insert\(\s*(wmsTables\.)?stockEvents\b/,
  /\.insert\(\s*(wmsTables\.)?stockLedgers\b/,
  /\.update\(\s*(wmsTables\.)?stockLedgers\b/,
];

// 발주 헤더는 조달이 소유한다(ADR-0032 결정 4 · #724 항목 7 스펙 §5). 입고가 직접 쓰면
// received 진입 규칙이 두 모듈로 갈라지고 잠금 취득 지점이 하나 늘어난다.
const PO_FORBIDDEN = [/\.(insert|update)\(\s*(wmsTables\.)?purchaseOrders\b/];

describe('inventory write boundary (arch)', () => {
  it('StockEventStore 외부에서 stockEvents/stockLedgers 직접 쓰기 금지', () => {
    const violations: string[] = [];
    for (const file of collectTsFiles(INVENTORY_ROOT)) {
      if (LEDGER_ALLOW_FILES.has(basename(file))) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (LEDGER_FORBIDDEN.some((re) => re.test(line))) violations.push(`${file}:${i + 1}  ${line.trim()}`);
        });
    }
    expect(violations).toEqual([]);
  });

  it('procurement/ 밖에서 purchaseOrders 직접 쓰기 금지', () => {
    const violations: string[] = [];
    for (const file of collectTsFiles(INVENTORY_ROOT)) {
      if (file.includes(`${sep}procurement${sep}`)) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (PO_FORBIDDEN.some((re) => re.test(line))) violations.push(`${file}:${i + 1}  ${line.trim()}`);
        });
    }
    expect(violations).toEqual([]);
  });
});
