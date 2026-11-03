import { DbService, InjectDb } from '@app/db';
import { NotFoundError } from '@app/shared';
import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import type { UserServiceSchema } from 'apps/user-service/database/drizzle/schema';
import { generateInitialPassword } from '../../admin/auth/lib/generate-initial-password';
import { GrantAuthority } from '../assignments/grant-authority';
import { IamAuditCreator } from '../audit/iam-audit.creator';
import type { IamActor } from '../iam-actor';
import { IamNotAccountTenantError, IamSelfChangeError } from '../iam.errors';
import { PlatformRepository } from '../platform/platform.repository';
import { RoleRepository } from '../roles/role.repository';
import { ActorTenantReader } from '../tenancy/actor-tenant.reader';
import { PlatformOperatorManager } from '../tenancy/platform-operator.manager';
import { TenancyRepository } from '../tenancy/tenancy.repository';

/**
 * 테넌트의 관리자(보통 그 테넌트의 `master`)가 자기 테넌트 계정의 비밀번호를 초기화한다(ADR-0056). 테넌트 도메인엔 찾기 화면이
 * 없어 직원의 복구 길이 이것이다. 새 비밀번호는 한 번만 돌려주고(저장하지 않는다), 다음 로그인에 변경을 강제하며, 그 계정의
 * 세션을 끊는다. 테넌트는 토큰 테넌트뿐이다 — 다른 테넌트를 지정하는 길이 없다.
 */
@Injectable()
export class StaffPasswordManager {
  constructor(
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
    private readonly roles: RoleRepository,
    private readonly tenancy: TenancyRepository,
    private readonly platform: PlatformRepository,
    private readonly actorTenant: ActorTenantReader,
    private readonly operators: PlatformOperatorManager,
    private readonly authority: GrantAuthority,
    private readonly audit: IamAuditCreator,
  ) {}

  async reissue(actor: IamActor, userId: string): Promise<{ initialPassword: string }> {
    const initialPassword = generateInitialPassword();
    const hash = await bcrypt.hash(initialPassword, 10);
    await this.dbService.run(async (tx) => {
      const tenantId = await this.actorTenant.resolve(actor, tx);
      const user = await this.roles.findUser(userId, tx);
      if (!user) throw new NotFoundError('사용자를 찾을 수 없습니다.');
      if (user.id === actor.userId) throw new IamSelfChangeError();
      if (user.tenantId !== tenantId) throw new IamNotAccountTenantError();
      // 직원 계정만 — 고객 비밀번호는 이 길이 아니다(고객은 찾기 화면이 있고, 관리자 변경은 T 의 고객 권한 라우트다).
      if (!(await this.roles.hasLiveStaffRole(userId, tx))) throw new NotFoundError('직원 계정을 찾을 수 없습니다.');
      // 비밀번호를 정하는 것은 그 계정을 갖는 일이다 — 운영자 계정은 운영자만, 나머지는 그 계정의 역할을 줄 수 있는 사람만.
      if (await this.tenancy.isOperator(userId, tx)) await this.operators.assertOperator(actor, tx);
      await this.authority.assertCanGrant(tx, actor, await this.roles.activeRoleNamesOf(userId, tx));

      await this.platform.setPassword(userId, hash, true, tx);
      await this.platform.revokeUserSessions(userId, tx);
      await this.audit.record(tx, actor, {
        tenantId,
        action: 'user.password.reissue',
        targetType: 'user',
        targetId: userId,
        targetLabel: user.loginId,
        before: null,
        after: { mustChangePassword: true },
      });
    });
    return { initialPassword };
  }
}
