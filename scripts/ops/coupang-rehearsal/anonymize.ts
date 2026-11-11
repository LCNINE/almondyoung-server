import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * 쿠팡 응답의 개인정보 칸을 가짜 값으로 바꾼다. 상태·수량·금액·vendorItemId·상품명은 그대로 둔다.
 * 칸은 «키 이름 패턴»으로 어느 깊이에서든 가린다(응답 모양을 아직 모르는 칸까지 덮기 위해 — 공개 레포라 모자란 것보다 넘치는 편이 낫다).
 * 같은 원값은 `ids` 로 같은 가짜값이 된다(주문번호가 여러 파일에 나와도 짝이 유지된다).
 * 가리지 않은 문자열 칸은 `unchanged` 에 키 경로로 모은다 — CLI 가 보여 주면 사람이 커밋 전에 훑는다.
 */

import { COUPANG_LONG_ID_KEYS } from '../../../apps/channel-adapter/src/adapters/coupang/clients/coupang-json';

const LONG_ID_KEYS: ReadonlySet<string> = new Set([...COUPANG_LONG_ID_KEYS, 'originalShipmentBoxId', 'paymentId']);
const PERSON_NAME = /^(name|(orderer|receiver|requester|customer|buyer|recipient|sender|user|member)\w*name)$/i;
const PHONE = /phone|mobile|tel|safenumber|receivernumber|orderernumber/i;
const SSN = /ssn|clearancecode/i;
const ADDRESS = /addr/i;
const ZIP = /zip|postcode/i;
const EMAIL = /email/i;
const INVOICE = /^(invoicenumber|deliveryinvoiceno)$/i;
const CANCEL_REASON = /^cancelreason(category\d*)?$/i;

function isPiiKey(key: string): boolean {
  return (
    PERSON_NAME.test(key) ||
    PHONE.test(key) ||
    SSN.test(key) ||
    EMAIL.test(key) ||
    ADDRESS.test(key) ||
    ZIP.test(key) ||
    INVOICE.test(key) ||
    CANCEL_REASON.test(key) ||
    key === 'parcelPrintMessage'
  );
}

type Kind = 'name' | 'phone' | 'email' | 'addr' | 'addrDetail' | 'ssn' | 'invoice' | 'id';

function counted(ids: Map<string, string>, kind: Kind, original: string, make: (n: number) => string): string {
  const key = `${kind}:${original}`;
  const known = ids.get(key);
  if (known !== undefined) return known;
  let n = 1;
  for (const k of ids.keys()) if (k.startsWith(`${kind}:`)) n += 1;
  const fake = make(n);
  ids.set(key, fake);
  return fake;
}

/** 같은 자릿수의 가짜 숫자. 같은 종류 안에서 유일하도록 개수로 만든다. */
function fakeDigits(ids: Map<string, string>, kind: 'id' | 'invoice', original: string): string {
  return counted(ids, kind, original, (n) => {
    const digits = original.length;
    const width = Math.max(digits - 1, 1);
    return `9${String(n).padStart(width, '0').slice(-width)}`.slice(0, digits);
  });
}

function anonymizeScalar(
  key: string,
  value: unknown,
  ids: Map<string, string>,
  unchanged?: Set<string>,
  path = key,
): unknown {
  if (LONG_ID_KEYS.has(key) && (typeof value === 'string' || typeof value === 'number')) {
    const fake = fakeDigits(ids, 'id', String(value));
    return typeof value === 'number' ? Number(fake) : fake;
  }
  if (value === null || value === undefined) return value;
  if (typeof value !== 'string') {
    // 개인정보 칸 아래의 숫자·불리언 등도 새지 않게 한다: 숫자는 자릿수를 지킨 가짜 숫자, 나머지는 null.
    if (!isPiiKey(key)) return value;
    return typeof value === 'number' ? Number(fakeDigits(ids, 'invoice', String(Math.abs(value)))) : null;
  }
  if (PERSON_NAME.test(key)) return counted(ids, 'name', value, (n) => `테스트고객${n}`);
  if (PHONE.test(key)) return counted(ids, 'phone', value, (n) => `050-0000-${String(n).padStart(4, '0')}`);
  if (SSN.test(key)) return counted(ids, 'ssn', value, (n) => `P${String(n).padStart(11, '0')}`);
  if (EMAIL.test(key)) return counted(ids, 'email', value, (n) => `user-${n}@example.com`);
  if (ADDRESS.test(key)) {
    return /(2|detail)$/i.test(key)
      ? counted(ids, 'addrDetail', value, (n) => `${n}호`)
      : counted(ids, 'addr', value, (n) => `서울시 테스트구 ${n}`);
  }
  if (ZIP.test(key)) return '00000';
  if (key === 'parcelPrintMessage') return '배송 메모';
  if (CANCEL_REASON.test(key)) return '취소 사유';
  if (INVOICE.test(key)) return fakeDigits(ids, 'invoice', value);
  unchanged?.add(path);
  return value;
}

function walk(value: unknown, key: string, path: string, ids: Map<string, string>, unchanged?: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => walk(item, key, `${path}[]`, ids, unchanged));
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [childKey, child] of Object.entries(value)) {
      out[childKey] = walk(child, childKey, path === '' ? childKey : `${path}.${childKey}`, ids, unchanged);
    }
    return out;
  }
  return anonymizeScalar(key, value, ids, unchanged, path);
}

export function anonymizeCoupangPayload(value: unknown, ids: Map<string, string>, unchanged?: Set<string>): unknown {
  return walk(value, '', '', ids, unchanged);
}

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

/** `--in=<raw 디렉터리> --to=<자료 디렉터리>` — raw/*.json 을 가짜 값으로 바꿔 쓴다. 원본은 지우지 않는다(사람이 지운다). */
function main(): void {
  const inDir = argValue('in');
  const toDir = argValue('to');
  if (!inDir || !toDir) {
    console.error('사용법: anonymize.ts --in=<out>/raw --to=<자료 디렉터리>');
    process.exit(2);
  }
  const ids = new Map<string, string>();
  const unchanged = new Set<string>();
  mkdirSync(toDir, { recursive: true });
  for (const file of readdirSync(inDir)
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    const parsed: unknown = JSON.parse(readFileSync(join(inDir, file), 'utf8'));
    writeFileSync(join(toDir, file), `${JSON.stringify(anonymizeCoupangPayload(parsed, ids, unchanged), null, 2)}\n`);
    console.log(`${file} -> ${join(toDir, file)}`);
  }
  console.log('\n바꾸지 않은 문자열 칸(키 경로). 커밋 전에 실제 값이 섞인 칸이 없는지 훑는다:');
  [...unchanged].sort().forEach((path) => console.log(`  ${path}`));
}

if (require.main === module) main();
