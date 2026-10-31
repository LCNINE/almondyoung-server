import { TENANCY_ENV } from './tenancy-env';
import { TenancyConfigError } from './tenancy-config.error';

export interface TenantEntry {
  readonly id: string;
  readonly slug: string;
  readonly coreDb: string;
  readonly publicBucket: string;
  readonly privateBucket: string;
}

const FIELDS = ['id', 'slug', 'coreDb', 'publicBucket', 'privateBucket'] as const;
type Field = (typeof FIELDS)[number];

const S3_BUCKET = { re: /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, rule: 'S3 버킷 이름 규칙' };

// 값이 그대로 흘러가는 곳의 문법: id 는 토큰·헤더·메트릭 라벨, slug 는 DB 이름(`core_<slug>`),
// coreDb 는 DB 도구가 SQL 식별자로 쓴다, 버킷은 S3 이름 규칙.
// 테넌트 행을 만드는 user-service 운영자 API 도 같은 문법으로 받는다 — 행과 목록이 같은 값이어야 한다.
export const TENANT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const TENANT_SLUG_PATTERN = /^[a-z][a-z0-9]{0,31}$/;

const PATTERNS: Record<Field, { re: RegExp; rule: string }> = {
  id: { re: TENANT_ID_PATTERN, rule: '영문·숫자·_·- 64자 이하' },
  slug: { re: TENANT_SLUG_PATTERN, rule: '소문자 영문으로 시작하는 소문자 영문·숫자 32자 이하' },
  coreDb: { re: /^[a-z_][a-z0-9_]{0,62}$/, rule: '소문자·숫자·_ 63자 이하 (Postgres 식별자)' },
  publicBucket: S3_BUCKET,
  privateBucket: S3_BUCKET,
};

export class TenantList {
  constructor(readonly entries: readonly TenantEntry[]) {}

  find(id: string): TenantEntry | undefined {
    return this.entries.find((t) => t.id === id);
  }
}

/**
 * 테넌트 목록 Secret(`TENANT_LIST`)을 읽는다. 틀린 목록은 `TenancyConfigError` 로 거절한다 —
 * 부팅 중에 부르면 앱이 뜨지 않는다. 목록에 «기본 테넌트»는 없다.
 * 메시지에는 테넌트 id 와 칸 이름만 싣는다 — slug·DB·버킷 값은 비공개라 로그로 보내지 않는다.
 */
export function parseTenantList(raw: string | undefined): TenantList {
  const name = TENANCY_ENV.tenantList;
  const fail = (problems: string[]) => new TenancyConfigError(name, problems);

  if (!raw?.trim()) throw fail([`${name} 가 없다 — 기본 목록은 없다`]);

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    // JSON.parse 의 메시지는 원문 조각을 실을 수 있어 버린다.
    throw fail(['JSON 이 아니다']);
  }

  if (!Array.isArray(json)) throw fail(['테넌트 항목의 배열이어야 한다']);
  if (json.length === 0) throw fail(['테넌트가 하나도 없다']);

  const problems: string[] = [];
  const entries: TenantEntry[] = [];
  json.forEach((item: unknown, i) => {
    const entry = readEntry(item, `[${i}]`, problems);
    if (entry) entries.push(entry);
  });

  problems.push(
    ...duplicates(entries, 'id'),
    ...duplicates(entries, 'slug'),
    ...duplicates(entries, 'coreDb'),
    ...sharedBuckets(entries),
    ...singleBucketTenants(entries),
  );
  if (problems.length > 0) throw fail(problems);

  return new TenantList(entries);
}

function readEntry(item: unknown, at: string, problems: string[]): TenantEntry | undefined {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) {
    problems.push(`${at} 객체가 아니다`);
    return undefined;
  }

  const record = new Map<string, unknown>(Object.entries(item));
  const before = problems.length;

  for (const key of record.keys()) {
    if (!FIELDS.some((f) => f === key)) problems.push(`${at} 모르는 칸 ${key}`);
  }

  const read = (key: Field): string => {
    const value = record.get(key);

    if (typeof value !== 'string' || value.trim() === '') {
      problems.push(`${at} ${key} 가 없다 (비어 있지 않은 문자열이어야 한다)`);
      return '';
    }
    if (!PATTERNS[key].re.test(value)) problems.push(`${at} ${key} 형식이 틀렸다 — ${PATTERNS[key].rule}`);

    return value;
  };
  const entry: TenantEntry = {
    id: read('id'),
    slug: read('slug'),
    coreDb: read('coreDb'),
    publicBucket: read('publicBucket'),
    privateBucket: read('privateBucket'),
  };

  return problems.length === before ? entry : undefined;
}

/** 같은 값을 가진 테넌트끼리 묶는다. */
function groupIdsBy(entries: readonly TenantEntry[], valuesOf: (e: TenantEntry) => string[]): Set<string>[] {
  const groups = new Map<string, Set<string>>();
  for (const e of entries) {
    for (const value of valuesOf(e)) groups.set(value, (groups.get(value) ?? new Set()).add(e.id));
  }

  return [...groups.values()];
}

function duplicates(entries: readonly TenantEntry[], key: Field): string[] {
  if (key === 'id') {
    const seen = new Map<string, number>();
    for (const e of entries) seen.set(e.id, (seen.get(e.id) ?? 0) + 1);

    return [...seen].filter(([, n]) => n > 1).map(([id, n]) => `id «${id}» 가 ${n}번 나온다`);
  }

  return groupIdsBy(entries, (e) => [e[key]])
    .filter((ids) => ids.size > 1)
    .map((ids) => `${key} 가 테넌트 ${quoted(ids)} 에서 겹친다`);
}

/** 버킷 하나를 두 테넌트가 쓰면 파일 접근 판정의 2차 방어선(버킷)이 사라진다. */
function sharedBuckets(entries: readonly TenantEntry[]): string[] {
  return groupIdsBy(entries, (e) => [...new Set([e.publicBucket, e.privateBucket])])
    .filter((ids) => ids.size > 1)
    .map((ids) => `버킷 하나를 테넌트 ${quoted(ids)} 가 함께 쓴다`);
}

/**
 * 공개·비공개를 버킷 하나에 두고 객체 ACL 로 가르는 것은 테넌트가 하나이던 시절의 테넌트 1 뿐이다.
 * 그 밖의 테넌트는 두 버킷이 달라야 한다. 테넌트 1 의 id 를 코드에 두지 않으려고
 * «그런 테넌트는 많아야 하나»로 적는다 — 테넌트 1 이 이미 그 자리를 쓰므로 다른 테넌트는 들어올 수 없다.
 * ⚠️ 그래서 목록에 테넌트 1 이 없거나 테넌트 1 이 두 버킷을 나눠 쓰는 목록에선 다른 테넌트 하나가 이 자리를 쓸 수 있다.
 */
function singleBucketTenants(entries: readonly TenantEntry[]): string[] {
  const ids = entries.filter((e) => e.publicBucket === e.privateBucket).map((e) => e.id);
  if (ids.length <= 1) return [];

  return [`공용 버킷(publicBucket = privateBucket)은 테넌트 1 한 곳만 쓸 수 있다 — 지금 ${quoted(ids)}`];
}

function quoted(ids: Iterable<string>): string {
  return [...ids].map((id) => `«${id}»`).join(', ');
}

/**
 * core DB 접속 주소가 가리키는 DB 의 테넌트. core 는 테넌트마다 DB 가 따로라 «행이 든 DB 가 곧 테넌트»다.
 * 목록의 `coreDb` 중 어느 것도 아니면 기동을 거부한다 — 모르는 DB 의 outbox 를 아무 테넌트로나 내보내지 않는다.
 */
export function tenantOfCoreDatabase(tenants: TenantList, databaseUrl: string | undefined): TenantEntry {
  const name = 'DATABASE_URL';
  let database: string | undefined;
  try {
    database = databaseUrl ? decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, '')) : undefined;
  } catch {
    database = undefined;
  }
  if (!database) throw new TenancyConfigError(name, [`${name} 에서 DB 이름을 읽지 못했다`]);

  const entry = tenants.entries.find((t) => t.coreDb === database);
  // DB 이름은 비공개 값이라 메시지에 싣지 않는다(tenant-list.ts 와 같은 규칙).
  if (!entry) throw new TenancyConfigError(name, [`${name} 의 DB 가 테넌트 목록의 어느 coreDb 도 아니다`]);
  return entry;
}
