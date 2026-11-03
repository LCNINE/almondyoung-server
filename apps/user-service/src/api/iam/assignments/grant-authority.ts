import type { Permission } from '@app/authorization';
import { Injectable } from '@nestjs/common';
import type { UserServiceTx } from 'apps/user-service/database/drizzle/schema';
import type { IamActor } from '../iam-actor';
import { IamEscalationError } from '../iam.errors';
import { MyPermissionsReader } from '../my-permissions.reader';
import { RolePermissionsReader } from '../role-permissions.reader';
import { RoleRepository } from '../roles/role.repository';
import { isCustomerRole } from '../rules/iam-rules';

/** 고객 역할(회원 등급)을 바꾸는 데 필요한 권한. */
const CUSTOMER_ROLE_CHANGE_PERMISSION: Permission = 'customer.profile.write';

/**
 * 권한 상승 방지 — 바뀌는 역할의 권한을 요청자가 모두 가져야 한다. 주는 것도, 회수하는 것도(줄 수 없는 역할은 회수도 못 한다:
 * 낮은 권한자가 상위 관리자를 강등하지 못하게 하는 우리 정책). 남의 비밀번호를 정하는 것도 그 계정을 갖는 일이라 같은 문을 지난다.
 */
@Injectable()
export class GrantAuthority {
  constructor(
    private readonly roles: RoleRepository,
    private readonly myPermissions: MyPermissionsReader,
    private readonly snapshots: RolePermissionsReader,
  ) {}

  async assertCanGrant(tx: UserServiceTx, actor: IamActor, roleNames: readonly string[]): Promise<void> {
    const [snapshot, mine] = await Promise.all([
      this.snapshots.snapshot(),
      this.actorRoles(tx, actor).then((names) => this.myPermissions.forRoles(names)),
    ]);
    const held = new Set(mine.permissions);
    // 고객 역할(회원 등급)을 바꾸는 것은 고객 정보를 고치는 일이다 — 고객 정보를 고칠 수 있는 사람만 바꾼다.
    if (roleNames.some(isCustomerRole) && !held.has(CUSTOMER_ROLE_CHANGE_PERMISSION)) {
      throw new IamEscalationError(
        `고객 역할을 주거나 회수하려면 '${CUSTOMER_ROLE_CHANGE_PERMISSION}' 권한이 필요합니다.`,
      );
    }
    for (const name of new Set(roleNames)) {
      const grants = Object.hasOwn(snapshot.roles, name) ? snapshot.roles[name] : [];
      const beyond = grants.filter((key) => !held.has(key));
      if (beyond.length > 0) {
        throw new IamEscalationError(
          `'${name}' 역할을 주거나 회수할 수 없습니다 — 내가 가진 권한만 줄 수 있습니다: ${beyond.join(', ')}`,
        );
      }
    }
  }

  /** 토큰의 역할 중 지금도 유효한 것만 — 토큰 발급 뒤 기간이 끝나거나 회수된 역할로 남에게 권한을 주지 못하게. */
  private async actorRoles(tx: UserServiceTx, actor: IamActor): Promise<string[]> {
    const active = new Set(await this.roles.activeRoleNamesOf(actor.userId, tx));
    return actor.roles.filter((name) => active.has(name));
  }
}
