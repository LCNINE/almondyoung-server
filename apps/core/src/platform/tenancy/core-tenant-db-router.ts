import type { DbRouter } from '@app/db';
import { TENANT_CONTEXT_KEY, type TenancyConfig } from '@app/tenancy';
import type { ClsService } from 'nestjs-cls';

/** 테넌트 맥락 없이 core DB 에 닿았다. 기본 테넌트로 떨어지지 않는다 — 맥락을 세우는 곳(요청·메시지·크론 루프)이 빠졌다. */
export class TenantContextMissingError extends Error {
  constructor() {
    super('테넌트 맥락 없이 core DB 에 닿았다 — 요청·메시지·크론 루프가 맥락을 세워야 한다');
    this.name = 'TenantContextMissingError';
  }
}

/** 맥락의 테넌트가 테넌트 목록에 없다. */
export class TenantNotListedError extends Error {
  constructor(tenantId: string) {
    super(`테넌트 «${tenantId}» 가 테넌트 목록에 없다`);
    this.name = 'TenantNotListedError';
  }
}

/**
 * core 의 DB 라우터. 테넌트마다 목록의 `coreDb` 에 풀을 하나씩 두고, CLS 맥락(`TENANT_CONTEXT_KEY`)의 테넌트로 고른다.
 *
 * 전환 배포 ①(warn)에서는 라우터가 없다(null) — core 는 기존 단일 DB(DATABASE_URL)를 그대로 쓰고, 맥락 없는 요청은
 * 요청 문이 세기만 한다. ① 에서 «맥락이 없으면 테넌트 1» 로 라우팅하면 기본 테넌트가 코드에 들어오므로 그러지 않는다.
 * 라우팅과 «없으면 거절»은 ②(reject)에서 함께 켜진다 — 같은 값(`TENANT_GATE_MODE`) 하나로 갈린다.
 */
export function coreTenantDbRouter(tenancy: TenancyConfig, cls: ClsService | undefined): DbRouter | null {
  if (tenancy.gateMode === 'warn') return null;
  if (!cls) throw new Error('core: 테넌트 라우팅(reject)에는 ClsModule 이 있어야 한다');

  return {
    databases: new Map(tenancy.tenants.entries.map((t) => [t.id, t.coreDb])),
    current(): string {
      const tenant = cls.isActive() ? cls.get<string | undefined>(TENANT_CONTEXT_KEY) : undefined;
      if (!tenant) throw new TenantContextMissingError();
      if (!tenancy.tenants.find(tenant)) throw new TenantNotListedError(tenant);
      return tenant;
    },
    // 새 CLS 맥락을 열어 그 안에서만 테넌트를 세운다 — 바깥 맥락(돌던 요청·다른 테넌트 루프)에 새지 않는다.
    within<T>(tenant: string, fn: () => Promise<T>): Promise<T> {
      return cls.run(() => {
        cls.set(TENANT_CONTEXT_KEY, tenant);
        return fn();
      });
    },
  };
}
