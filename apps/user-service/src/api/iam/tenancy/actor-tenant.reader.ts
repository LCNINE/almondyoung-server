import { Injectable } from '@nestjs/common';
import type { UserServiceTx } from 'apps/user-service/database/drizzle/schema';
import type { IamActor } from '../iam-actor';
import { IamTenantUnresolvedError } from '../iam.errors';
import { TenancyRepository } from './tenancy.repository';

/**
 * 관리 API 를 부른 사람이 지금 일하는 테넌트 — 부여·이력이 이 테넌트에 남는다. 토큰 테넌트가 정한다.
 *
 * 토큰 테넌트 클레임 전에 나간 토큰(액세스 토큰 수명 동안만 남는다)은 소속으로 정한다: 정확히 하나여야 한다.
 */
@Injectable()
export class ActorTenantReader {
  constructor(private readonly tenancy: TenancyRepository) {}

  async resolve(actor: IamActor, tx?: UserServiceTx): Promise<string> {
    if (actor.tenantId) return actor.tenantId;
    const tenants = await this.tenancy.tenantsOf(actor.userId, tx);
    if (tenants.length !== 1) throw new IamTenantUnresolvedError();
    return tenants[0];
  }
}
