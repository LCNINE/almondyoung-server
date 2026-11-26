import { Injectable } from '@nestjs/common';
import type { IamActor } from '../iam-actor';
import { RoleRepository } from '../roles/role.repository';
import { ActorTenantReader } from '../tenancy/actor-tenant.reader';
import type { StaffNameDto } from './dto/staff-names.dto';

/** 요청자 테넌트에서 지금 직원 역할을 가진 계정의 이름만 답한다. 고객·다른 테넌트의 id 는 빠진다. */
@Injectable()
export class StaffNamesReader {
  constructor(
    private readonly roles: RoleRepository,
    private readonly actorTenant: ActorTenantReader,
  ) {}

  async namesOf(actor: IamActor, userIds: readonly string[]): Promise<StaffNameDto[]> {
    const tenantId = await this.actorTenant.resolve(actor);

    return this.roles.liveStaffNamesIn([...new Set(userIds)], tenantId);
  }
}
