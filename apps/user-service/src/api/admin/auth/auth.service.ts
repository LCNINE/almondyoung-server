import { DbService, InjectDb } from '@app/db';
import { Injectable } from '@nestjs/common';
import {
  userServiceSchema,
  UserServiceSchema,
} from 'apps/user-service/database/drizzle/schema';
import { DbTransaction } from 'apps/user-service/src/commons/types';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../../users/users.service';
import { CreateAccountDto } from './dto/create-account-dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
    private readonly usersService: UsersService,
  ) {}

  private getClient(tx?: DbTransaction) {
    return tx ?? this.dbService.db;
  }

  async createAccount(createAccountDto: CreateAccountDto, tx?: DbTransaction) {
    const client = this.getClient(tx);

    const { loginId, password, roleId, phone_number, email } = createAccountDto;

    let existingUser;
    existingUser = await this.usersService.findUserByLoginId(loginId);

    if (existingUser) {
      throw new Error('This user already exists.');
    }
    existingUser = await this.usersService.findUserByEmail(email);
    if (existingUser) {
      throw new Error('This user already exists.');
    }

    if (tx) {
      // 이미 트랜잭션이 있으면 그대로 사용
      return this._createAccountWithTransaction(createAccountDto, tx);
    } else {
      // 트랜잭션이 없으면 새로 생성
      return await this.dbService.db.transaction(async (newTx) => {
        return this._createAccountWithTransaction(createAccountDto, newTx);
      });
    }

    // await this.eventPublisher.publishEvent('USER_UPDATED', {
    //     userId,
    //     ...updateUserDto,
    //   });

    return; // 추후 프론트엔드에서 메두사  http://localhost:9000/auth/user/my-auth/register 호출해서 메두사에도 등록해줘야함
  }

  private async _createAccountWithTransaction(
    createAccountDto: CreateAccountDto,
    tx?: DbTransaction,
  ) {
    const client = this.getClient(tx);

    const {
      loginId,
      password,
      roleId,
      phone_number,
      email,
      username,
      nickname,
    } = createAccountDto;

    const saltOrRounds = 10;
    const hash = await bcrypt.hash(password, saltOrRounds);

    // 유저 생성
    const [user] = await client
      .insert(userServiceSchema.users)
      .values({
        username,
        nickname,
        loginId,
        password: hash,
        isEmailVerified: true,
        email,
      })
      .returning();

    // 유저 역할(등급) 할당
    await this.usersService.assignUserRole(user.id, roleId, tx);

    // 유저 프로필 생성
    await this.usersService.updateMyProfile(
      user.id,
      {
        phoneNumber: phone_number,
      },
      tx,
    );

    return user;
  }
}
