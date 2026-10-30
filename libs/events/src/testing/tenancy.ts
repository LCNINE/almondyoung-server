import { DynamicModule, Global, Module } from '@nestjs/common';
import { TenancyConfig, parseTenantList, type TenantGateMode, type TenantList } from '@app/tenancy';

@Global()
@Module({})
class TestTenancyModule {}

const ONE_TENANT = parseTenantList(
  JSON.stringify([{ id: '1', slug: 'one', coreDb: 'core', publicBucket: 'b-one', privateBucket: 'b-one' }]),
);

/**
 * 테스트 앱의 테넌트 목록 — `startConsumer` 는 목록 없이 뜨지 않는다. 문 자체를 재는 스펙이 아니면
 * `tenancy: 'per-message'` 와 ① warn 으로 띄워 테넌트 없는 픽스처 메시지도 지금처럼 핸들러에 닿게 한다.
 * 문의 계약은 `tenancy/event-tenant-gate.spec.ts` 가 잰다.
 */
export function testTenancyModule(gateMode: TenantGateMode = 'warn', tenants: TenantList = ONE_TENANT): DynamicModule {
  return {
    module: TestTenancyModule,
    providers: [{ provide: TenancyConfig, useValue: new TenancyConfig(tenants, gateMode) }],
    exports: [TenancyConfig],
  };
}
