import { DbService, InjectDb } from '@app/db';
import { NotFoundError } from '@app/shared';
import { Injectable } from '@nestjs/common';
import type { UserServiceSchema, UserServiceTx } from 'apps/user-service/database/drizzle/schema';
import { IamAuditCreator } from '../audit/iam-audit.creator';
import type { IamActor } from '../iam-actor';
import { IamLastOperatorError, IamOperatorOnlyError, IamSelfChangeError } from '../iam.errors';
import { RoleRepository } from '../roles/role.repository';
import { ActorTenantReader } from './actor-tenant.reader';
import { TenancyRepository } from './tenancy.repository';

/**
 * 플랫폼 운영자 성질 — 테넌트 역할이 아니라 계정에 붙는다. 잠김 방지는 여기 하나다: 로그인할 수 있는 운영자가 최소 1명
 * 남아야 한다(옛 «마지막 master 보유자» 규칙을 대신한다 — master 는 이제 테넌트 안의 전권 역할일 뿐이다).
 */
@Injectable()
export class PlatformOperatorManager {
  constructor(
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
    private readonly tenancy: TenancyRepository,
    private readonly roles: RoleRepository,
    private readonly audit: IamAuditCreator,
    private readonly actorTenant: ActorTenantReader,
  ) {}

  /**
   * 운영자만 하는 일의 문 — 권한 키가 아니라 계정 성질을 본다(테넌트 안의 master 도 운영자가 아니면 거절). 변경과 같은
   * 트랜잭션에서 부른다.
   */
  async assertOperator(actor: IamActor, tx: UserServiceTx): Promise<void> {
    if (!(await this.tenancy.isOperator(actor.userId, tx))) throw new IamOperatorOnlyError();
  }

  /**
   * 관리 API 가 일할 테넌트. 요청이 테넌트를 지정하지 않으면 요청자 테넌트, 지정하면 운영자만 그 테넌트로 일한다 — 다른 테넌트의
   * 계정·부여를 만드는 것은 테넌트 역할이 아니라 운영자의 일이다.
   */
  async workingTenant(actor: IamActor, requested: string | undefined, tx: UserServiceTx): Promise<string> {
    if (requested === undefined) return this.actorTenant.resolve(actor, tx);
    await this.assertOperator(actor, tx);
    if (!(await this.tenancy.tenantExists(requested, tx)))
      throw new NotFoundError(`테넌트를 찾을 수 없습니다: ${requested}`);
    return requested;
  }

  /** 운영자 성질을 주거나 거둔다. 운영자만, 남에게만 한다. */
  async setOperator(actor: IamActor, userId: string, isOperator: boolean): Promise<void> {
    await this.dbService.run(async (tx) => {
      await this.assertOperator(actor, tx);
      if (userId === actor.userId) throw new IamSelfChangeError();
      const user = await this.roles.findUser(userId, tx);
      if (!user) throw new NotFoundError('사용자를 찾을 수 없습니다.');

      const was = await this.tenancy.isOperator(userId, tx);
      if (was === isOperator) return;
      if (!isOperator) await this.assertAnotherRemains(tx, userId);

      await this.tenancy.setOperator(userId, isOperator, tx);
      await this.audit.record(tx, actor, {
        tenantId: null,
        action: 'user.platform_operator.set',
        targetType: 'user',
        targetId: userId,
        targetLabel: user.loginId,
        before: { isPlatformOperator: was },
        after: { isPlatformOperator: isOperator },
      });
    });
  }

  /**
   * 탈퇴 전 확인 — 마지막 운영자는 떠날 수 없다. 운영자 행을 잠그고 세므로 탈퇴 트랜잭션 안에서 부른다(`tx`) — 잠금이
   * 탈퇴가 끝날 때까지 남아 동시 탈퇴·강등이 차례로 판정된다.
   */
  async assertCanLeave(userId: string, tx?: UserServiceTx): Promise<void> {
    await this.dbService.run(async (tx) => {
      if (!(await this.tenancy.isOperator(userId, tx))) return;
      await this.assertAnotherRemains(tx, userId);
    }, tx);
  }

  private async assertAnotherRemains(tx: UserServiceTx, leavingUserId: string): Promise<void> {
    await this.tenancy.lockOperators(tx);
    if ((await this.tenancy.countSignInOperators(leavingUserId, tx)) < 1) throw new IamLastOperatorError();
  }
}
