import { DbService, InjectDb } from '@app/db';
import { Injectable } from '@nestjs/common';
import * as schema from '../../database/drizzle/schema';

import { eq } from 'drizzle-orm';

@Injectable()
export class UsersService {
  constructor(@InjectDb() private readonly dbService: DbService<schema.User>) {}

  async findUserByEmail(email: string): Promise<schema.User | null> {
    const users = await this.dbService.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);

    return users.length > 0 ? users[0] : null;
  }

  async findUserByUsername(username: string): Promise<schema.User | null> {
    const users = await this.dbService.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, username))
      .limit(1);

    return users.length > 0 ? users[0] : null;
  }

  async findUserById(
    id: string,
  ): Promise<Omit<schema.User, 'password'> | null> {
    const users = await this.dbService.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .limit(1);

    const { password, ...userWithoutPassword } = users[0];

    return userWithoutPassword;
  }
}
