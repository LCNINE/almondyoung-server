import { DbService, InjectDb } from '@app/db';
import { Injectable } from '@nestjs/common';
import * as schema from '../../../database/drizzle/schema';
import { eq } from 'drizzle-orm';

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

  async findUserByUserId(id: string): Promise<schema.User | null> {
    const [users] = await this.dbService.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.userId, id))
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
}
