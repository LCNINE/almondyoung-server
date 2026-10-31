import { requireServedTenant, TENANCY_ENV, TenancyConfig } from '@app/tenancy';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

/**
 * user-service 의 앱 설정 T — 고객·근태처럼 user-service 안에 있지만 한 테넌트의 것인 데이터와, 옛 내부 토큰
 * (`aud=user-service-internal`, 쇼핑몰·auth-web 세션)이 섬기는 테넌트. 계정·소속·부여·토큰 발급 자체는 모든 테넌트의 일이다.
 * 목록에 없는 T 면 기동을 거부한다(`requireServedTenant`).
 */
export const SERVED_TENANT_ID = Symbol('SERVED_TENANT_ID');

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: SERVED_TENANT_ID,
      inject: [TenancyConfig, ConfigService],
      useFactory: (tenancy: TenancyConfig, config: ConfigService): string =>
        requireServedTenant(tenancy.tenants, config.get<string>(TENANCY_ENV.servedTenantId)).id,
    },
  ],
  exports: [SERVED_TENANT_ID],
})
export class ServedTenantModule {}
