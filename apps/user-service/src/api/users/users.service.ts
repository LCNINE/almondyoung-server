import { DbService, InjectDb } from '@app/db';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import * as schema from '../../../database/drizzle/schema';
import { User } from '../../../database/drizzle/schema';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(@InjectDb() private readonly dbService: DbService<schema.User>) {}

  async findUserByEmail(email: string): Promise<schema.User | null> {
    const [users] = await this.dbService.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);

    return users;
  }

  async findUserByUsername(username: string): Promise<schema.User | null> {
    const [users] = await this.dbService.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, username))
      .limit(1);

    return users;
  }

  async findUserByLoginId(id: string): Promise<schema.User | null> {
    const [users] = await this.dbService.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.loginId, id))
      .limit(1);

    return users;
  }

  async findUserById(id: string): Promise<schema.User | null> {
    const [users] = await this.dbService.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .limit(1);

    return users;
  }

  async update(user: User, updateUserDto: UpdateUserDto): Promise<void> {
    const { username, ...address } = updateUserDto;

    if (!username && Object.keys(address).length === 0) {
      throw new BadRequestException('업데이트할 데이터가 없습니다.');
    }

    try {
      if (username) {
        await this.dbService.db
          .update(schema.users)
          .set({ username })
          .where(eq(schema.users.id, user.id));
      }

      if (Object.keys(address).length > 0) {
        await this.dbService.db
          .insert(schema.profiles)
          .values({
            userId: user.id,
            address,
          })
          .onConflictDoUpdate({
            target: schema.profiles.userId,
            set: {
              address,
            },
          });
      }
    } catch (error) {
      throw new InternalServerErrorException(
        '사용자 정보 업데이트 중 오류가 발생했습니다.',
      );
    }
  }
}
