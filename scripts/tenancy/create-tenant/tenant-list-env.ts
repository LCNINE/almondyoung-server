import { parseTenantList, TenantEntry } from '../../../libs/tenancy/src/tenant-list';
import { StepRefused } from './runner';

/**
 * 로컬 `.env` 한 파일의 `TENANT_LIST='[…]'` 줄을 고친다 — 로컬에서 «목록 Secret 에 넣기»가 이것이다.
 * 다른 줄은 한 글자도 안 건드린다. 결과 목록은 앱과 같은 파서를 통과해야 쓴다(틀린 목록이면 앱이 뜨지 않는다).
 */
const LINE = /^TENANT_LIST='([^']*)'$/m;

// 목록 항목의 칸 순서 — 정본(e2e-env-map.sh)이 쓰는 모양 그대로 직렬화한다.
export const toJson = (e: TenantEntry) =>
  JSON.stringify({
    id: e.id,
    slug: e.slug,
    coreDb: e.coreDb,
    publicBucket: e.publicBucket,
    privateBucket: e.privateBucket,
  });

function listOf(envText: string): { raw: string; entries: TenantEntry[] } | null {
  const m = LINE.exec(envText);
  if (!m) return null;
  return { raw: m[1], entries: [...parseTenantList(m[1]).entries] };
}

/** 목록 JSON — 앱과 같은 파서를 통과해야 돌려준다 */
export function serializeTenantList(entries: readonly TenantEntry[]): string {
  const raw = `[${entries.map(toJson).join(',')}]`;
  parseTenantList(raw);
  return raw;
}

function replaceList(envText: string, entries: TenantEntry[]): string {
  const raw = serializeTenantList(entries);
  return envText.replace(LINE, () => `TENANT_LIST='${raw}'`);
}

export const sameEntry = (a: TenantEntry, b: TenantEntry) => toJson(a) === toJson(b);

/** 같은 항목이 있으면 true. 같은 id 가 다른 값으로 있으면 거절한다 — «안 넣었다»로 보면 되돌리기가 남의 테넌트를 건드린다. */
export function envListsTenant(envText: string, entry: TenantEntry): boolean {
  const existing = listOf(envText)?.entries.find((e) => e.id === entry.id);
  if (existing && !sameEntry(existing, entry)) throw foreignEntry(entry.id);
  return !!existing;
}

export const foreignEntry = (id: string) =>
  new StepRefused(`목록에 테넌트 ${id} 가 다른 값으로 이미 있다 — 덮지 않는다`);

export function addTenantToEnv(envText: string, entry: TenantEntry): string {
  const list = listOf(envText);
  if (!list) throw new Error("TENANT_LIST='…' 줄이 없다 — npm run bootstrap:e2e:local 의 0-b 가 만든다");
  const existing = list.entries.find((e) => e.id === entry.id);
  if (existing && sameEntry(existing, entry)) return envText;
  if (existing) throw foreignEntry(entry.id);
  return replaceList(envText, [...list.entries, entry]);
}

export function removeTenantFromEnv(envText: string, tenantId: string): string {
  const list = listOf(envText);
  if (!list || !list.entries.some((e) => e.id === tenantId)) return envText;
  return replaceList(
    envText,
    list.entries.filter((e) => e.id !== tenantId),
  );
}
