import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OUTBOX_TENANT_FROM_CONTEXT, OUTBOX_TENANT_ID, type OutboxTenant } from '@app/events';
import { TenancyConfig, tenantOfCoreDatabase } from '@app/tenancy';

/**
 * core 의 outbox 행은 그 행이 든 DB 의 테넌트로 나간다. core 는 앱 설정 T 가 없는 «메시지마다» 앱이라 디스패처가 T 로 찍을 수 없다.
 *
 * - ① (warn): 단일 DB(DATABASE_URL)다. 그 DB 이름을 테넌트 목록의 `coreDb` 와 대조해 정한다. 목록에 없는 DB 면 기동 거부.
 * - ② (reject): 테넌트마다 DB 가 따로고 라우터가 맥락으로 고른다. 디스패처가 테넌트 DB 마다 그 맥락에서 도므로 맥락이 곧
 *   행이 든 DB 의 테넌트다. DATABASE_URL 의 DB 이름은 접속 정보일 뿐 테넌트를 말하지 않는다.
 *
 * 갈림은 라우터(`coreTenantDbRouter`)와 같은 값 하나(`TENANT_GATE_MODE`)다.
 */
export function coreOutboxTenant(tenancy: TenancyConfig, databaseUrl: string | undefined): OutboxTenant {
  if (tenancy.gateMode === 'reject') return OUTBOX_TENANT_FROM_CONTEXT;
  return tenantOfCoreDatabase(tenancy.tenants, databaseUrl).id;
}

/** `@Global()` 인 이유는 `FulfillmentOutboxDispatchGateModule` 과 같다 — 디스패처는 catalog 의 `forApp` 안에서 만들어진다. */
@Global()
@Module({
  providers: [
    {
      provide: OUTBOX_TENANT_ID,
      inject: [TenancyConfig, ConfigService],
      useFactory: (tenancy: TenancyConfig, config: ConfigService): OutboxTenant =>
        coreOutboxTenant(tenancy, config.get<string>('DATABASE_URL')),
    },
  ],
  exports: [OUTBOX_TENANT_ID],
})
export class CoreOutboxTenantModule {}
