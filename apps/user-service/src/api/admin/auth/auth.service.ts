import { ConflictError } from '@app/shared';
import { DbService, InjectDb } from '@app/db';
import { Injectable, Logger } from '@nestjs/common';
import { userServiceSchema, UserServiceSchema } from 'apps/user-service/database/drizzle/schema';
import { DbTransaction } from 'apps/user-service/src/commons/types';
import * as bcrypt from 'bcrypt';
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
  ) {}

  private getClient(tx?: DbTransaction) {
    return tx ?? this.dbService.db;
  }

  async createAccount(createAccountDto: CreateAccountDto, tx?: DbTransaction) {
    const { loginId, email } = createAccountDto;

    if (await this.usersService.findUserByLoginId(loginId)) {
      throw new ConflictError('이미 존재하는 로그인 ID 입니다.');
    }
    if (await this.usersService.findUserByEmail(email)) {
      throw new ConflictError('이미 존재하는 이메일 입니다.');
    }

    if (tx) {
      return this._createAccountWithTransaction(createAccountDto, tx);
    }
    return this.dbService.db.transaction((newTx) => this._createAccountWithTransaction(createAccountDto, newTx));
  }

  private async _createAccountWithTransaction(createAccountDto: CreateAccountDto, tx: DbTransaction) {
    const client = this.getClient(tx);
    const { loginId, roleId, phone_number, email, username, nickname } = createAccountDto;

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
        mustChangePassword: true,
        email,
      })
      .returning();

    await this.usersService.assignUserRole(user.id, roleId, tx);
    await this.usersService.updateMyProfile(user.id, { phoneNumber: phone_number }, tx);

    return {
      user: { id: user.id, loginId: user.loginId, email: user.email, username: user.username },
      initialPassword,
    };
  }

  async changePassword(changePasswordDto: ChangePasswordDto) {
    const { loginId, newPassword } = changePasswordDto;

    const user = await this.usersService.findUserByLoginId(loginId);
    if (!user) {
      throw new Error('User not found');
    }

    const saltOrRounds = 10;
    const hash = await bcrypt.hash(newPassword, saltOrRounds);

    const client = this.getClient();
    await client.update(userServiceSchema.users).set({ password: hash }).where(eq(userServiceSchema.users.id, user.id));

    return { message: '비밀번호가 변경되었습니다.' };
  }

}
