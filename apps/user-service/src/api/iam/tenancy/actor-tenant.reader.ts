import { Injectable } from '@nestjs/common';
import type { UserServiceTx } from 'apps/user-service/database/drizzle/schema';
import type { IamActor } from '../iam-actor';
import { IamTenantUnresolvedError } from '../iam.errors';
import { TenancyRepository } from './tenancy.repository';

/**
 * 관리 API 를 부른 사람이 지금 일하는 테넌트 — 부여·이력이 이 테넌트에 남는다. 토큰 테넌트가 정한다.
 *
 * 토큰에 테넌트가 없으면(클레임 도입 전에 나간 토큰) 요청자 계정의 테넌트다 — 계정은 한 테넌트의 것이다(ADR-0056).
 */
@Injectable()
export class ActorTenantReader {
  constructor(private readonly tenancy: TenancyRepository) {}

  async resolve(actor: IamActor, tx?: UserServiceTx): Promise<string> {
    if (actor.tenantId) return actor.tenantId;
    const tenantId = await this.tenancy.accountTenantOf(actor.userId, tx);
    if (!tenantId) throw new IamTenantUnresolvedError();
    return tenantId;
  }
}
