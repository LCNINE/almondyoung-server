import { DbService, InjectDb } from '@app/db';
import * as schema from '../../../../database/drizzle/schema';
import { CreateAccountDto } from './dto/create-account-dto';
import { UsersService } from '../../users/users.service';
import { BadRequestException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { DbTransaction } from 'apps/user-service/src/commons/types';

@Injectable()
export class AuthService {
  constructor(
    @InjectDb() private readonly dbService: DbService<schema.User>,
    private readonly usersService: UsersService,
  ) {}

  private getClient(tx?: DbTransaction) {
    return tx ?? this.dbService.db;
  }

  async createAccount(createAccountDto: CreateAccountDto, tx?: DbTransaction) {
    const client = this.getClient(tx);

    const { name, loginId, password, roleId, phone_number, email } =
      createAccountDto;

    let existingUser;
    existingUser = await this.usersService.findUserByLoginId(loginId);

    if (existingUser) {
      throw new Error('This user already exists.');
    }
    existingUser = await this.usersService.findUserByEmail(email);
    if (existingUser) {
      throw new Error('This user already exists.');
    }

    // await this.eventPublisher.publishEvent('USER_UPDATED', {
    //     userId,
    //     ...updateUserDto,
    //   });

    return;
  }

  private async _createAccountWithTransaction(
    createAccountDto: CreateAccountDto,
    tx: DbTransaction,
  ) {
    const client = this.getClient(tx);

    const { name, loginId, password, roleId, phone_number, email, nickname } =
      createAccountDto;

    const saltOrRounds = 10;
    const hash = await bcrypt.hash(password, saltOrRounds);

    // 유저 생성
    const [user] = await tx
      .insert(schema.users)
      .values({
        username: name,
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
    await this.usersService.update(
      user.id,
      {
        phoneNumber: phone_number,
      },
      tx,
    );

    return user;
  }
}
