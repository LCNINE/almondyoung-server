import { DbService, InjectDb } from '@app/db';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { type UserServiceSchema } from 'apps/user-service/database/drizzle/schema';
import { and, asc, count, desc, eq, ilike, inArray, isNull, or } from 'drizzle-orm';
import * as schema from '../../../../database/drizzle/schema';
import { AdminUserDetailResponseDto } from './dto/admin-user-detail.response.dto';
import { UpdateUserDto } from '../../users/dto/update-user.dto';
import { AddressDto } from '../../../commons/dto/address.dto';
import { DbTransaction } from 'apps/user-service/src/commons/types';
import { UserConsent } from '../../consents/types/consent.type';

export type UserWithRoles = schema.UserWithoutPassword & { roles: string[] };

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
    q?: string;
    page?: number;
    limit?: number;
    roleName?: string;
    sort?: 'createdAt' | 'username' | 'email' | 'lastActivityAt';
    order?: 'asc' | 'desc';
    tx?: DbTransaction;
  }): Promise<{
    data: UserWithRoles[];
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
      const sortOrder = filters?.order || 'desc';

      const conditions = [] as any[];
      if (filters?.q) {
        const searchTerm = `%${filters.q}%`;
        conditions.push(
          or(
            ilike(schema.users.username, searchTerm),
            ilike(schema.users.email, searchTerm),
            ilike(schema.users.loginId, searchTerm),
          ),
        );
      }
      if (filters?.roleName) {
        const roleName = filters.roleName.trim();
        if (roleName.length > 0) {
          const userIdsByRoleQuery = client
            .select({ userId: schema.userRoleAssignments.userId })
            .from(schema.userRoleAssignments)
            .innerJoin(schema.roles, eq(schema.userRoleAssignments.roleId, schema.roles.roleId))
            .where(and(eq(schema.roles.name, roleName), isNull(schema.userRoleAssignments.expiresAt)));
          conditions.push(inArray(schema.users.id, userIdsByRoleQuery));
        }
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      // total count
      const countQuery = client.select({ count: count() }).from(schema.users);
      if (whereClause) {
        countQuery.where(whereClause);
      }
      const [{ count: total }] = await countQuery;

      // data query
      const orderExpr = sortOrder === 'asc' ? asc((schema.users as any)[sortBy]) : desc((schema.users as any)[sortBy]);

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

      const users = await dataQuery;

      const userIds = users.map((u) => u.id);
      const roleRows =
        userIds.length > 0
          ? await client
              .select({
                userId: schema.userRoleAssignments.userId,
                roleName: schema.roles.name,
              })
              .from(schema.userRoleAssignments)
              .innerJoin(schema.roles, eq(schema.userRoleAssignments.roleId, schema.roles.roleId))
              .where(
                and(inArray(schema.userRoleAssignments.userId, userIds), isNull(schema.userRoleAssignments.expiresAt)),
              )
          : [];

      const rolesByUserId = new Map<string, string[]>();
      for (const row of roleRows) {
        const list = rolesByUserId.get(row.userId) ?? [];
        list.push(row.roleName);
        rolesByUserId.set(row.userId, list);
      }

      const data: UserWithRoles[] = users.map((u) => ({
        ...u,
        roles: rolesByUserId.get(u.id) ?? [],
      }));

      return { data, total, page, limit };
    } catch (error) {
      throw new BadRequestException(error.message ?? '사용자 조회 중 오류가 발생했습니다.');
    }
  }

  async getUserById(userId: string): Promise<AdminUserDetailResponseDto> {
    const client = this.getClient();

    const [user] = await client
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
        shop: schema.shops,
        profile: schema.profiles,
      })
      .from(schema.users)
      .leftJoin(schema.shops, eq(schema.users.id, schema.shops.userId))
      .leftJoin(schema.profiles, eq(schema.users.id, schema.profiles.userId))
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (!user) {
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
    }

    const roleRows = await client
      .select({ roleName: schema.roles.name })
      .from(schema.userRoleAssignments)
      .innerJoin(schema.roles, eq(schema.userRoleAssignments.roleId, schema.roles.roleId))
      .where(and(eq(schema.userRoleAssignments.userId, userId), isNull(schema.userRoleAssignments.expiresAt)));

    return {
      ...user,
      roles: roleRows.map((r) => r.roleName),
      profile: user.profile ? { ...user.profile, address: user.profile.address as AddressDto | null } : null,
    };
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

  async getUserConsentByUserId(userId: string, tx?: DbTransaction): Promise<UserConsent | null> {
    const client = this.getClient(tx);
    const [result] = await client.select().from(schema.userConsents).where(eq(schema.userConsents.userId, userId));
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
      .orderBy(order === 'asc' ? asc(schema.userConsents[sortBy]) : desc(schema.userConsents[sortBy]));
    return result;
  }
}
