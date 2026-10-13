/**
 * user-service `GET /me/permissions` 응답과 그 캐시.
 *
 * 응답은 «토큰의 역할»만을 입력으로 계산된다(user-service 가 DB 가 아니라 토큰 역할을 쓴다).
 * 그래서 같은 역할 조합이면 누구의 응답이든 같고, 캐시 키를 역할 조합으로 둘 수 있다.
 * 주기는 백엔드 서비스들의 권한 사본과 같은 30초 — 화면과 API 가 같은 속도로 따라온다.
 */
export interface MyRole {
  readonly name: string;
  readonly displayName: string;
}

export interface MyPermissions {
  readonly roles: readonly MyRole[];
  readonly permissions: ReadonlySet<string>;
  readonly version: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseMyPermissions(body: unknown): MyPermissions {
  const data = isRecord(body) && 'data' in body && isRecord(body.data) ? body.data : body;
  if (!isRecord(data)) throw new Error('my-permissions body is malformed');
  const { roles, permissions, version } = data;
  if (!Array.isArray(roles) || !Array.isArray(permissions) || typeof version !== 'string') {
    throw new Error('my-permissions body is malformed');
  }
  const parsedRoles = roles.map((r): MyRole => {
    if (!isRecord(r) || typeof r.name !== 'string' || typeof r.displayName !== 'string') {
      throw new Error('my-permissions role entry is malformed');
    }
    return { name: r.name, displayName: r.displayName };
  });
  const keys = permissions.filter((p): p is string => typeof p === 'string');
  if (keys.length !== permissions.length) throw new Error('my-permissions holds a non-string permission');
  return { roles: parsedRoles, permissions: new Set(keys), version };
}

/** 역할 이름은 사람이 정한다 — 구분자로 잇지 않고 정렬한 배열을 JSON 으로. */
export function rolesKey(roles: readonly string[]): string {
  return JSON.stringify([...new Set(roles)].sort());
}

interface Entry {
  value: MyPermissions | null;
  /** 이 시각 전에는 원본을 다시 부르지 않는다 — 성공 뒤엔 주기만큼, 실패 뒤엔 재시도 간격만큼. */
  nextAttemptAt: number;
  inFlight: Promise<void> | null;
  /** value 를 받은 시각(실패한 재조회는 바꾸지 않는다) */
  fetchedAt: number;
}

export class MyPermissionsCache {
  private readonly entries = new Map<string, Entry>();
  private readonly ttlMs: number;
  private readonly retryMs: number;
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(
    private readonly fetcher: (roles: readonly string[]) => Promise<MyPermissions>,
    options: { ttlMs?: number; retryMs?: number; maxKeys?: number; now?: () => number } = {},
  ) {
    this.ttlMs = options.ttlMs ?? 30_000;
    this.retryMs = options.retryMs ?? 5_000;
    this.maxKeys = options.maxKeys ?? 200;
    this.now = options.now ?? Date.now;
  }

  /**
   * null = 한 번도 받지 못했다(판정 불가). 실패하면 마지막 사본을 계속 주고, 원본은 재시도 간격이 지나야
   * 다시 부른다 — 원본이 죽었을 때 요청마다 타임아웃을 기다리지 않게.
   */
  async get(roles: readonly string[]): Promise<MyPermissions | null> {
    return (await this.getWithTime(roles))?.value ?? null;
  }

  /** `get` 과 같고, 돌려주는 사본을 받은 시각을 함께 준다(브라우저 캐시에 그대로 넘길 때). */
  async getWithTime(roles: readonly string[]): Promise<{ value: MyPermissions; fetchedAt: number } | null> {
    const key = rolesKey(roles);
    let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= this.maxKeys) this.entries.clear();
      entry = { value: null, fetchedAt: 0, nextAttemptAt: Number.NEGATIVE_INFINITY, inFlight: null };
      this.entries.set(key, entry);
    }
    if (this.now() >= entry.nextAttemptAt) {
      const target = entry;
      target.inFlight ??= this.fetcher(roles)
        .then((value) => {
          target.value = value;
          target.fetchedAt = this.now();
          target.nextAttemptAt = this.now() + this.ttlMs;
        })
        .catch(() => {
          target.nextAttemptAt = this.now() + this.retryMs;
        })
        .finally(() => {
          target.inFlight = null;
        });
      await target.inFlight;
    } else if (entry.inFlight) {
      await entry.inFlight;
    }
    return entry.value ? { value: entry.value, fetchedAt: entry.fetchedAt } : null;
  }
}
