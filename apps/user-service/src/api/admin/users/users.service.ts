import { DbService, InjectDb } from '@app/db';
import { BadRequestException, Injectable } from '@nestjs/common';
import { type UserServiceSchema } from 'apps/user-service/database/drizzle/schema';
import { and, asc, count, desc, eq } from 'drizzle-orm';
import * as schema from '../../../../database/drizzle/schema';
import { UpdateUserDto } from '../../users/dto/update-user.dto';
import { DbTransaction } from 'apps/user-service/src/commons/types';
import { UserConsent } from '../../consents/types/consent.type';

@Injectable()
export class UsersService {
  constructor(
    @InjectDb()
    private readonly dbService: DbService<UserServiceSchema>,
  ) {}

  private getClient(tx?: DbTransaction) {
    return tx ?? this.dbService.db;
  }

  async getUsers(filters: {
    page?: number;
    limit?: number;
    userId?: string;
    username?: string;
    email?: string;
    sort?: 'createdAt' | 'username' | 'email' | 'lastActivityAt';
    order?: 'asc' | 'desc';
    tx?: DbTransaction;
  }): Promise<{
    data: schema.UserWithoutPassword[];
    total: number;
    page: number;
    limit: number;
  }> {
    try {
      const client = this.getClient(filters?.tx);
      const page = filters?.page || 1;
      const limit = Math.min(filters?.limit || 20, 100);
      const offset = (page - 1) * limit;
      const sortBy = filters?.sort || 'createdAt';
      const sortOrder = (filters?.order || 'desc') as 'asc' | 'desc';

      const conditions = [] as any[];
      if (filters?.userId) conditions.push(eq(schema.users.id, filters.userId));
      if (filters?.username)
        conditions.push(eq(schema.users.username, filters.username));
      if (filters?.email)
        conditions.push(eq(schema.users.email, filters.email));

      const whereClause =
        conditions.length > 0 ? and(...conditions) : undefined;

      // total count
      const countQuery = client.select({ count: count() }).from(schema.users);
      if (whereClause) {
        countQuery.where(whereClause);
      }
      const [{ count: total }] = await countQuery;

      // data query
      const orderExpr =
        sortOrder === 'asc'
          ? asc((schema.users as any)[sortBy])
          : desc((schema.users as any)[sortBy]);

      const dataQuery = client
        .select({
          id: schema.users.id,
          loginId: schema.users.loginId,
          username: schema.users.username,
          nickname: schema.users.nickname,
          email: schema.users.email,
          isEmailVerified: schema.users.isEmailVerified,
          lastActivityAt: schema.users.lastActivityAt,
          deletedAt: schema.users.deletedAt,
          createdAt: schema.users.createdAt,
          updatedAt: schema.users.updatedAt,
        })
        .from(schema.users)
        .orderBy(orderExpr)
        .limit(limit)
        .offset(offset);
      if (whereClause) {
        dataQuery.where(whereClause);
      }

      const data = await dataQuery;

      return { data, total, page, limit };
    } catch (error) {
      throw new BadRequestException(
        error.message ?? '사용자 조회 중 오류가 발생했습니다.',
      );
    }
  }

  async updateUser(
    userId: string,
    updateUserDto: UpdateUserDto,
    tx?: DbTransaction,
  ): Promise<schema.UserWithoutPassword | null> {
    const client = this.getClient(tx);

    const [result] = await client
      .update(schema.users)
      .set({ ...updateUserDto })
      .where(eq(schema.users.id, userId))
      .returning({
        id: schema.users.id,
        loginId: schema.users.loginId,
        username: schema.users.username,
        nickname: schema.users.nickname,
        email: schema.users.email,
        isEmailVerified: schema.users.isEmailVerified,
        lastActivityAt: schema.users.lastActivityAt,
        deletedAt: schema.users.deletedAt,
        createdAt: schema.users.createdAt,
        updatedAt: schema.users.updatedAt,
      });

    return result ?? null;
  }

  async getUserConsentByUserId(
    userId: string,
    tx?: DbTransaction,
  ): Promise<UserConsent | null> {
    const client = this.getClient(tx);
    const [result] = await client
      .select()
      .from(schema.userConsents)
      .where(eq(schema.userConsents.userId, userId));
    return result ?? null;
  }

  async getUserConsents(
    params: {
      page: number;
      limit: number;
      sortBy: 'createdAt' | 'username' | 'email' | 'lastActivityAt';
      order: 'asc' | 'desc';
    },
    tx?: DbTransaction,
  ): Promise<UserConsent[] | null> {
    const client = this.getClient(tx);

    const { page, limit, sortBy, order } = params;

    const result = await client
      .select()
      .from(schema.userConsents)
      .limit(limit)
      .offset((page - 1) * limit)
      .orderBy(
        order === 'asc'
          ? asc(schema.userConsents[sortBy])
          : desc(schema.userConsents[sortBy]),
      );
    return result;
  }
}
