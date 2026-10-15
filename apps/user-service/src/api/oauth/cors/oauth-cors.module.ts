import { DbModule } from '@app/db';
import { Module } from '@nestjs/common';
import { PublicClientOriginsCache } from './public-client-origins.cache';
import { PublicClientOriginsRepository } from './public-client-origins.repository';

// main.ts 의 CORS delegator 와 admin oauth-clients(무효화)가 같은 캐시 인스턴스를 쓴다.
@Module({
  imports: [DbModule],
  providers: [PublicClientOriginsCache, PublicClientOriginsRepository],
  exports: [PublicClientOriginsCache],
})
export class OAuthCorsModule {}
