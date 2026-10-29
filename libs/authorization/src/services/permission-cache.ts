import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PERMISSION_RUNTIME_OPTIONS, PermissionRuntimeOptions } from './permission-runtime.options';
import { reportSnapshotStatus } from './permission-snapshot.metrics';
import { RolePermissionSnapshot, RolePermissionSource } from './role-permission-source';

export interface PermissionCacheStatus {
  readonly state: 'disabled' | 'cold' | 'ready';
  readonly version: string | null;
  /** 마지막으로 원본과 맞춰 본 뒤 지난 시간. 실패가 이어지면 늘어난다. */
  readonly ageMs: number | null;
  readonly consecutiveFailures: number;
}

/** 역할 조합 캐시 상한. 토큰의 역할은 서명돼 있어 실제로는 몇 가지뿐이다. */
const MAX_ROLE_SETS = 1_000;

/**
 * user-service 가 가진 역할별 권한의 프로세스 내 사본.
 *
 * 요청 경로는 이 사본만 본다(네트워크 0). 버전 확인은 배경에서 주기적으로 하고, 실패하면 마지막
 * 사본을 그대로 쓴다. 한 번도 받지 못했으면 `permissionsFor` 가 null — 판정 불가를 «권한 없음»과
 * 섞지 않으려고 빈 집합을 돌려주지 않는다.
 *
 * 크론이 아니다: 사본은 프로세스마다 있어야 하므로 모든 인스턴스가 각자 돈다.
 */
@Injectable()
export class PermissionCache implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PermissionCache.name);
  private current: { version: string; byRole: ReadonlyMap<string, ReadonlySet<string>> } | null = null;
  private checkedAt: number | null = null;
  private consecutiveFailures = 0;
  private stopped = false;
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | null = null;
  private readonly roleSets = new Map<string, ReadonlySet<string>>();

  constructor(
    private readonly source: RolePermissionSource,
    @Inject(PERMISSION_RUNTIME_OPTIONS) private readonly options: PermissionRuntimeOptions,
  ) {}

  /** 운영 도구가 이 줄을 찾는다(형식 고정). 판정은 항상 새 권한 판정이 한다. */
  onModuleInit(): void {
    this.logger.log(`authz mode: enforce (${this.options.service})`);
    reportSnapshotStatus(this.options.service, () => this.status());
  }

  onApplicationBootstrap(): void {
    if (!this.source.isConfigured()) {
      this.logger.warn('permission source is not configured — permission checks stay unavailable');
      return;
    }
    void this.tick();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /** 한 번 맞춰 본다. 이미 도는 중이면 그 결과를 같이 기다린다. */
  refresh(): Promise<void> {
    this.inFlight ??= this.load().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  permissionsFor(roles: readonly string[]): ReadonlySet<string> | null {
    if (!this.current) return null;
    const names = [...new Set(roles)].sort();
    // 역할 이름은 사람이 정한다 — 어떤 구분자로 이어 붙여도 이름 안의 같은 문자와 겹친다. 배열째 직렬화한다.
    const key = JSON.stringify(names);
    const hit = this.roleSets.get(key);
    if (hit) return hit;

    const merged = new Set<string>();
    for (const name of names) for (const permission of this.current.byRole.get(name) ?? []) merged.add(permission);
    if (this.roleSets.size >= MAX_ROLE_SETS) this.roleSets.clear();
    this.roleSets.set(key, merged);
    return merged;
  }

  /** 이 권한을 가진 역할 이름(정렬). 사본이 없으면 null — «아무도 없음»과 섞지 않는다. */
  rolesHolding(permission: string): readonly string[] | null {
    if (!this.current) return null;

    const holders: string[] = [];
    for (const [role, keys] of this.current.byRole) {
      if (keys.has(permission)) holders.push(role);
    }

    return holders.sort();
  }

  status(now = Date.now()): PermissionCacheStatus {
    return {
      state: this.current ? 'ready' : this.source.isConfigured() ? 'cold' : 'disabled',
      version: this.current?.version ?? null,
      ageMs: this.checkedAt === null ? null : now - this.checkedAt,
      consecutiveFailures: this.consecutiveFailures,
    };
  }

  private async tick(): Promise<void> {
    await this.refresh();
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), this.nextDelay());
    this.timer.unref();
  }

  private nextDelay(): number {
    if (this.current) return this.options.refreshIntervalMs;
    const backoff = this.options.retryBaseMs * 2 ** Math.max(this.consecutiveFailures - 1, 0);
    return Math.min(backoff, this.options.refreshIntervalMs);
  }

  private async load(): Promise<void> {
    try {
      const result = await this.source.fetch(this.current?.version ?? null);
      if (result.status === 'loaded') this.install(result.snapshot);
      this.checkedAt = Date.now();
      if (this.consecutiveFailures > 0) {
        this.logger.log(`permission snapshot reachable again after ${this.consecutiveFailures} failed checks`);
      }
      this.consecutiveFailures = 0;
    } catch (error) {
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures === 1) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(`permission snapshot check failed — keeping the last copy: ${reason}`);
      }
    }
  }

  private install(snapshot: RolePermissionSnapshot): void {
    const byRole = new Map<string, ReadonlySet<string>>();
    for (const [role, keys] of snapshot.roles) byRole.set(role, new Set(keys));
    const changed = this.current?.version !== snapshot.version;
    this.current = { version: snapshot.version, byRole };
    this.roleSets.clear();
    if (changed) this.logger.log(`permission snapshot ${snapshot.version} loaded (${byRole.size} roles)`);
  }
}
