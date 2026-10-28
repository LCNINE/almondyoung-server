import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 스토어프론트 반품 사유·거절 문구 표가 Medusa 정본과 같은지 소스 텍스트로 대조한다 (K8 PR8 · N8).
 * `web/**` 은 CI 워크플로가 없고 루트 jest 는 `/apps/medusa/` 를 무시하므로, 두 트리를 import 하지 않고 텍스트로 읽는다.
 */
const REPO = join(__dirname, '..', '..');
const MEDUSA_REASONS = 'apps/medusa/src/workflows/orders/returns/return-reasons.ts';
const MEDUSA_PLAN = 'apps/medusa/src/workflows/orders/returns/plan-return-request.ts';
const STOREFRONT_REASONS = 'web/almondyoung-storefront/src/domains/order/return-request/return-reasons.ts';

const read = (relative: string) => readFileSync(join(REPO, relative), 'utf8');

/** `export type <typeName> =` 의 문자열 리터럴 유니온. 못 찾거나 0개면 throw. */
function readStringUnion(source: string, typeName: string): string[] {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => new RegExp(`^export type ${typeName}\\s*=`).test(line));
  if (start < 0) throw new Error(`export type ${typeName} 를 찾지 못했다`);
  const body = [lines[start].slice(lines[start].indexOf('=') + 1)];
  for (const line of lines.slice(start + 1)) {
    if (!/^\s*(\||\/\/|'|")/.test(line)) break;
    body.push(line);
  }
  const literals = body
    .map((line) => line.replace(/\/\/.*$/, ''))
    .flatMap((line) => [...line.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2]));
  if (literals.length === 0) throw new Error(`${typeName} 에서 문자열 리터럴을 하나도 읽지 못했다`);
  return literals;
}

type Row = { value: string; feeBearer: string; customerSelectable: boolean };

function medusaReasons(): Row[] {
  const rows = [
    ...read(MEDUSA_REASONS).matchAll(
      /\{ value: '([^']+)', label: '[^']*', feeBearer: '(\w+)', customerSelectable: (true|false) \}/g,
    ),
  ].map((m) => ({ value: m[1], feeBearer: m[2], customerSelectable: m[3] === 'true' }));
  if (rows.length === 0) throw new Error('Medusa RETURN_REASONS 행을 하나도 읽지 못했다');
  return rows;
}

/** `{ value: "x", feeBearer: "y" }` 행들 (큰따옴표·작은따옴표 모두). */
function storefrontCustomerReasons(): Array<{ value: string; feeBearer: string }> {
  const rows = [...read(STOREFRONT_REASONS).matchAll(/\{\s*value:\s*["']([^"']+)["'],\s*feeBearer:\s*["'](\w+)["']\s*\}/g)].map(
    (m) => ({ value: m[1], feeBearer: m[2] }),
  );
  if (rows.length === 0) throw new Error('스토어프론트 CUSTOMER_RETURN_REASONS 행을 하나도 읽지 못했다');
  return rows;
}

/** `<tableName> ... = { ... }` 객체 리터럴의 키. */
function storefrontTableKeys(tableName: string): string[] {
  const source = read(STOREFRONT_REASONS);
  const start = source.search(new RegExp(`export const ${tableName}\\b`));
  if (start < 0) throw new Error(`${tableName} 를 찾지 못했다`);
  const open = source.indexOf('{', source.indexOf('=', start));
  const close = source.indexOf('\n}', open);
  const keys = [...source.slice(open, close).matchAll(/^\s*(?:["']([^"']+)["']|([A-Za-z_]\w*))\s*:/gm)].map((m) => m[1] ?? m[2]);
  if (keys.length === 0) throw new Error(`${tableName} 에서 키를 하나도 읽지 못했다`);
  return keys;
}

describe('스토어프론트 반품 표 ↔ Medusa 정본 (N8)', () => {
  it('스토어프론트 고객 사유 = Medusa customerSelectable 사유, 부담 주체까지 같다', () => {
    const medusa = medusaReasons()
      .filter((r) => r.customerSelectable)
      .map(({ value, feeBearer }) => ({ value, feeBearer }));
    expect(storefrontCustomerReasons()).toEqual(medusa);
  });

  it('사유 이름 키가 Medusa 사유 여섯을 전부 덮는다', () => {
    const medusa = medusaReasons().map((r) => r.value);
    expect(medusa).toHaveLength(6);
    expect(storefrontTableKeys('RETURN_REASON_LABEL_KEYS').sort()).toEqual(expect.arrayContaining(medusa));
  });

  it('거절 문구 키가 Medusa ReturnRejectReason 을 전부 덮는다', () => {
    const medusa = readStringUnion(read(MEDUSA_PLAN), 'ReturnRejectReason');
    expect(storefrontTableKeys('RETURN_REJECT_MESSAGE_KEYS')).toEqual(expect.arrayContaining(medusa));
  });
});
