import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OUTBOX_TENANT_ID } from '@app/events';
import { TenancyConfig, tenantOfCoreDatabase } from '@app/tenancy';

/**
 * core 의 outbox 행은 그 행이 든 DB 의 테넌트로 나간다. core 는 앱 설정 T 가 없는 «메시지마다» 앱이라
 * 디스패처가 T 로 찍을 수 없고, 접속한 DB 이름을 테넌트 목록의 `coreDb` 와 대조해 정한다. 목록에 없는 DB 면 기동 거부.
 * 배포 ① 의 단일 DB 는 테넌트 1 의 것이다. 테넌트마다 DB 를 도는 디스패처는 아직 없다.
 *
 * `@Global()` 인 이유는 `FulfillmentOutboxDispatchGateModule` 과 같다 — 디스패처는 catalog 의 `forApp` 안에서 만들어진다.
 */
@Global()
@Module({
  providers: [
    {
      provide: OUTBOX_TENANT_ID,
      inject: [TenancyConfig, ConfigService],
      useFactory: (tenancy: TenancyConfig, config: ConfigService): string =>
        tenantOfCoreDatabase(tenancy.tenants, config.get<string>('DATABASE_URL')).id,
    },
  ],
  exports: [OUTBOX_TENANT_ID],
})
export class CoreOutboxTenantModule {}
