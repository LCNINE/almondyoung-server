import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * 쿠팡 응답의 개인정보 칸만 가짜 값으로 바꾼다. 나머지(상태·수량·금액·vendorItemId·모르는 칸)는 그대로 둔다.
 * 같은 원값은 `ids` 로 같은 가짜값이 된다(주문번호가 여러 파일에 나와도 짝이 유지된다).
 */

const NAME_KEYS = new Set(['name']); // receiver.name · orderer.name
const PHONE_KEYS = new Set(['safeNumber', 'receiverNumber', 'ordererNumber', 'phone', 'tel', 'mobile']);
const EMAIL_KEYS = new Set(['email', 'ordererEmail']);
const LONG_ID_KEYS = new Set(['shipmentBoxId', 'orderId', 'receiptId']);

type Kind = 'name' | 'phone' | 'email' | 'addr1' | 'addr2' | 'memo' | 'id';

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

/** 같은 자릿수의 가짜 숫자. 전체 맵에서 유일하도록 id 개수로 만든다. */
function fakeLongId(ids: Map<string, string>, original: string): string {
  return counted(ids, 'id', original, (n) => {
    const digits = original.length;
    const tail = String(n)
      .padStart(Math.max(digits - 1, 1), '0')
      .slice(-Math.max(digits - 1, 1));
    return `9${tail}`.slice(0, digits);
  });
}

function anonymizeScalar(key: string, value: unknown, ids: Map<string, string>): unknown {
  if (LONG_ID_KEYS.has(key) && (typeof value === 'string' || typeof value === 'number')) {
    const fake = fakeLongId(ids, String(value));
    return typeof value === 'number' ? Number(fake) : fake;
  }
  if (typeof value !== 'string') return value;
  if (NAME_KEYS.has(key)) return counted(ids, 'name', value, (n) => `테스트고객${n}`);
  if (PHONE_KEYS.has(key)) return counted(ids, 'phone', value, (n) => `050-0000-${String(n).padStart(4, '0')}`);
  if (EMAIL_KEYS.has(key)) return counted(ids, 'email', value, (n) => `user-${n}@example.com`);
  if (key === 'addr1') return counted(ids, 'addr1', value, (n) => `서울시 테스트구 ${n}`);
  if (key === 'addr2') return counted(ids, 'addr2', value, (n) => `${n}호`);
  if (key === 'parcelPrintMessage') return '배송 메모';
  return value;
}

export function anonymizeCoupangPayload(value: unknown, ids: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map((item) => anonymizeCoupangPayload(item, ids));
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] =
        typeof child === 'object' && child !== null
          ? anonymizeCoupangPayload(child, ids)
          : anonymizeScalar(key, child, ids);
    }
    return out;
  }
  return value;
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
  mkdirSync(toDir, { recursive: true });
  for (const file of readdirSync(inDir)
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    const parsed: unknown = JSON.parse(readFileSync(join(inDir, file), 'utf8'));
    writeFileSync(join(toDir, file), `${JSON.stringify(anonymizeCoupangPayload(parsed, ids), null, 2)}\n`);
    console.log(`${file} -> ${join(toDir, file)}`);
  }
}

if (require.main === module) main();
