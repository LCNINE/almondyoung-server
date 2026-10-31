import { PermissionCheckpoints, type JwtPayload } from '@app/authorization';
import { ConflictError, ForbiddenError, NotFoundError } from '@app/shared';
import { DbService, InjectDb } from '@app/db';
import { Injectable, Logger } from '@nestjs/common';
import { userServiceSchema, UserServiceSchema, type UserServiceTx } from 'apps/user-service/database/drizzle/schema';
import { DbTransaction } from 'apps/user-service/src/commons/types';
import * as bcrypt from 'bcrypt';
import { RoleAssignmentManager } from '../../iam/assignments/role-assignment.manager';
import type { IamActor } from '../../iam/iam-actor';
import { PlatformOperatorManager } from '../../iam/tenancy/platform-operator.manager';
import { CUSTOMER_ROLE_NAMES } from '../../iam/iam.constants';
import { UsersService } from '../../users/users.service';
import { CreateAccountDto } from './dto/create-account-dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { generateInitialPassword } from './lib/generate-initial-password';
import { eq } from 'drizzle-orm';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
    private readonly usersService: UsersService,
    private readonly checkpoints: PermissionCheckpoints,
    private readonly roleAssignments: RoleAssignmentManager,
    private readonly operators: PlatformOperatorManager,
  ) {}

  private getClient(tx?: DbTransaction) {
    return tx ?? this.dbService.db;
  }

  async createAccount(createAccountDto: CreateAccountDto, actor: IamActor, tx?: UserServiceTx) {
    const { loginId, email } = createAccountDto;

    if (await this.usersService.findUserByLoginId(loginId)) {
      throw new ConflictError('이미 존재하는 로그인 ID 입니다.');
    }
    if (await this.usersService.findUserByEmail(email)) {
      throw new ConflictError('이미 존재하는 이메일 입니다.');
    }

    return this.dbService.run((trx) => this._createAccountWithTransaction(createAccountDto, actor, trx), tx);
  }

  private async _createAccountWithTransaction(createAccountDto: CreateAccountDto, actor: IamActor, tx: UserServiceTx) {
    const client = this.getClient(tx);
    const { loginId, roleId, phone_number, email, username, nickname, tenantId } = createAccountDto;
    // 첫 로그인 변경 강제를 끄는 것은 점검 계정용이다 — 운영자만.
    const mustChangePassword = createAccountDto.forcePasswordChange ?? true;
    if (!mustChangePassword) await this.operators.assertOperator(actor, tx);

    const initialPassword = generateInitialPassword();
    const hash = await bcrypt.hash(initialPassword, 10);

    const [user] = await client
      .insert(userServiceSchema.users)
      .values({
        username,
        nickname,
        loginId,
        password: hash,
        isEmailVerified: true,
        mustChangePassword,
        email,
      })
      .returning();

    // 첫 역할도 부여 규칙(권한 상승 방지·시스템 역할·테넌트 지정은 운영자만)과 변경 이력을 같은 트랜잭션으로 탄다.
    // 대행 계정은 고객 가입이 아니라 UserCreated 를 내지 않는다(그 이벤트의 소비자는 가입 혜택·고객 행을 만든다).
    await this.roleAssignments.assignOnCreate(tx, actor, user.id, roleId, tenantId);
    await this.usersService.updateMyProfile(user.id, { phoneNumber: phone_number }, tx);

    return {
      user: { id: user.id, loginId: user.loginId, email: user.email, username: user.username },
      initialPassword,
    };
  }

  /**
   * 관리자가 다른 계정의 비밀번호를 정한다.
   *
   * 직원 계정(고객 역할 밖의 역할을 가진 계정)은 계정 생성과 같은 권한(`iam.admin_user.write`)이 있어야 바꿀 수 있다 —
   * 회원 정보 수정 권한만으로는 고객 계정까지다.
   */
  async changePassword(changePasswordDto: ChangePasswordDto, actor: Pick<JwtPayload, 'roles'>) {
    const { loginId, newPassword } = changePasswordDto;

    const user = await this.usersService.findUserByLoginId(loginId);
    if (!user) {
      throw new NotFoundError('사용자를 찾을 수 없습니다.');
    }

    const targetRoles = await this.usersService.getUserRoleNames(user.id);
    const isStaffAccount = targetRoles.some((role) => !CUSTOMER_ROLE_NAMES.includes(role));
    if (isStaffAccount) {
      if (!this.checkpoints.check('iam.staff_password_reset', { roles: actor.roles ?? [] }, ['iam.admin_user.write'])) {
        throw new ForbiddenError('직원 계정의 비밀번호는 계정 생성 권한이 있어야 바꿀 수 있습니다.');
      }
    }

    const saltOrRounds = 10;
    const hash = await bcrypt.hash(newPassword, saltOrRounds);

    const client = this.getClient();
    await client.update(userServiceSchema.users).set({ password: hash }).where(eq(userServiceSchema.users.id, user.id));

    return { message: '비밀번호가 변경되었습니다.' };
  }
}
