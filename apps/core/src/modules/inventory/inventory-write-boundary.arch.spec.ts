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

// 발주 헤더·라인·수령 링크는 조달이 소유한다(ADR-0039). 입고·중립 층이 직접 쓰면
// received_qty 정산이 두 모듈로 갈라지고 잠금 취득 지점이 하나 늘어난다.
const PO_FORBIDDEN = [
  /\.(insert|update|delete)\(\s*(wmsTables\.)?(purchaseOrders|purchaseOrderLines|purchaseOrderReceiptLines)\b/,
];

function findForbiddenWrites(file: string, source: string, patterns: RegExp[]): string[] {
  const violations: string[] = [];
  for (const pattern of patterns) {
    const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    for (const match of source.matchAll(globalPattern)) {
      const lineNumber = source.slice(0, match.index).split('\n').length;
      violations.push(`${file}:${lineNumber}  ${match[0].replace(/\s+/g, ' ').trim()}`);
    }
  }
  return violations;
}

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

  it('procurement/ 밖에서 발주 헤더·라인·수령 링크 쓰기 금지', () => {
    const violations: string[] = [];
    for (const file of collectTsFiles(INVENTORY_ROOT)) {
      if (file.includes(`${sep}procurement${sep}`)) continue;
      violations.push(...findForbiddenWrites(file, readFileSync(file, 'utf8'), PO_FORBIDDEN));
    }
    expect(violations).toEqual([]);
  });

  it('발주 쓰기 가드는 한 줄과 여러 줄 호출을 시작 행과 함께 찾는다', () => {
    const source = [
      'await tx.update(wmsTables.purchaseOrders).set({ status });',
      'await tx',
      '  .update(',
      '    wmsTables.purchaseOrderLines,',
      '  )',
      '  .set({ receivedQty });',
    ].join('\n');

    expect(findForbiddenWrites('fixture.ts', source, PO_FORBIDDEN)).toEqual([
      'fixture.ts:1  .update(wmsTables.purchaseOrders',
      'fixture.ts:3  .update( wmsTables.purchaseOrderLines',
    ]);
  });
});
