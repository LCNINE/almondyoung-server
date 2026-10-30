import { Injectable } from '@nestjs/common';
import type { UserServiceTx } from 'apps/user-service/database/drizzle/schema';
import type { IamActor } from '../iam-actor';
import { IamTenantUnresolvedError } from '../iam.errors';
import { TenancyRepository } from './tenancy.repository';

/**
 * 관리 API 를 부른 사람이 지금 일하는 테넌트 — 부여·이력이 이 테넌트에 남는다.
 *
 * 토큰에 아직 테넌트가 없으므로 소속으로 정한다: 정확히 하나여야 한다. 지금은 테넌트 1 만 있고 직원은 모두 그 소속이라
 * 오늘의 동작이 그대로다. 토큰에 테넌트가 실리면 이 자리가 토큰 값을 쓴다 — 소속이 둘인 사람이 생기기 전에.
 */
@Injectable()
export class ActorTenantReader {
  constructor(private readonly tenancy: TenancyRepository) {}

  async resolve(actor: IamActor, tx?: UserServiceTx): Promise<string> {
    const tenants = await this.tenancy.tenantsOf(actor.userId, tx);
    if (tenants.length !== 1) throw new IamTenantUnresolvedError();
    return tenants[0];
  }
}
