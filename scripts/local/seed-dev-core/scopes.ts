import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { DbService } from '@app/db';
// 배럴(@app/authorization)은 passport/jwks-rsa 까지 끌어와 스크립트 기동이 느려진다. 필요한 것만 깊은 경로로.
import { AuthorizationService } from '@app/authorization/services/authorization.service';
import { ALL_SCOPES } from '../../../apps/core/src/platform/auth/merged-scopes';
import { FULFILLMENT_ROLE_MAPPINGS } from '../../../apps/core/src/platform/auth/fulfillment-scopes';
import { wmsSchema } from '../../../apps/core/src/modules/inventory/schema/inventory.schema';
import { makeDbService } from '../../../apps/core/src/modules/fulfillment/services/__support__';

/**
 * core 의 ScopeBootstrapService 가 부팅 시 하는 일과 동일하다.
 * 시드가 직접 하는 이유는 스펙 §4.2 — core 를 띄운 채 리셋해도 403 이 안 나게 하기 위함.
 */
export async function bootstrapScopes(db: PostgresJsDatabase<typeof wmsSchema>): Promise<void> {
  const dbService = makeDbService(db);
  // AuthorizationService 는 스키마 제네릭 없는 DbService 를 받는다. auth 스키마 테이블을
  // 직접 참조해 조회하므로 제네릭은 런타임에 무의미하고, 구조적으로만 호환시키면 된다.
  const service = new AuthorizationService(dbService as unknown as DbService, {
    microserviceName: 'almondyoung',
    scopes: ALL_SCOPES,
    roleMappings: FULFILLMENT_ROLE_MAPPINGS,
  });

  await service.ensureScopesExist('almondyoung', ALL_SCOPES);
  await service.ensureRoleScopeMappings(FULFILLMENT_ROLE_MAPPINGS);
}
