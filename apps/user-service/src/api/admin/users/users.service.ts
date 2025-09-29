import { DbService, InjectDb } from '@app/db';
import { BadRequestException, Injectable } from '@nestjs/common';
import { type UserServiceSchema } from 'apps/user-service/database/drizzle/schema';
import { and, asc, count, desc, eq } from 'drizzle-orm';
import * as schema from '../../../../database/drizzle/schema';

@Injectable()
export class UsersService {
  constructor(
    @InjectDb()
    private readonly dbService: DbService<UserServiceSchema>,
  ) {}

  async getUsers(filters: {
    page?: number;
    limit?: number;
    userId?: string;
    username?: string;
    email?: string;
    sort?: 'createdAt' | 'username' | 'email' | 'lastActivityAt';
    order?: 'asc' | 'desc';
  }): Promise<{
    data: schema.UserWithoutPassword[];
    total: number;
    page: number;
    limit: number;
  }> {
    try {
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
      const countQuery = this.dbService.db
        .select({ count: count() })
        .from(schema.users);
      if (whereClause) {
        countQuery.where(whereClause);
      }
      const [{ count: total }] = await countQuery;

      // data query
      const orderExpr =
        sortOrder === 'asc'
          ? asc((schema.users as any)[sortBy])
          : desc((schema.users as any)[sortBy]);

      const dataQuery = this.dbService.db
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
}
