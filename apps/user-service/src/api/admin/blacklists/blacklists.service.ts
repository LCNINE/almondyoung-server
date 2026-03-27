import { DbService, InjectDb } from '@app/db';
import { Injectable } from '@nestjs/common';
import { userServiceSchema, type UserServiceSchema } from 'apps/user-service/database/drizzle/schema';
import { DbTransaction } from 'apps/user-service/src/commons/types';
import { and, count, eq, ilike, or } from 'drizzle-orm';

import { BlacklistsCreateDto } from './dto/blacklists-create.dto';
import { BlacklistsResponseDto } from './dto/blacklists-response.dto';
import { BlacklistsAlreadyExistsException, BlacklistsNotFoundException } from './exceptions/blacklists.exceptions';

@Injectable()
export class BlacklistsService {
  constructor(@InjectDb() private readonly dbService: DbService<UserServiceSchema>) {}

  private getClient(tx?: DbTransaction) {
    return tx ?? this.dbService.db;
  }

  async getBlacklists(
    filters: { page?: number; limit?: number; userId?: string; q?: string },
    tx?: DbTransaction,
  ): Promise<{
    data: (BlacklistsResponseDto & { user: { username: string; nickname: string; email: string } | null })[];
    total: number;
    page: number;
    limit: number;
  }> {
    const client = this.getClient(tx);

    const page = filters?.page || 1;
    const limit = Math.min(filters?.limit || 20, 100);
    const offset = (page - 1) * limit;

    const whereConditions: any[] = [];
    if (filters?.userId) {
      whereConditions.push(eq(userServiceSchema.blacklists.userId, filters.userId));
    }
    if (filters?.q) {
      const searchTerm = `%${filters.q}%`;
      whereConditions.push(
        or(
          ilike(userServiceSchema.users.username, searchTerm),
          ilike(userServiceSchema.users.nickname, searchTerm),
          ilike(userServiceSchema.users.email, searchTerm),
          ilike(userServiceSchema.blacklists.reason, searchTerm),
        ),
      );
    }

    const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;

    // count 쿼리도 조인해서 검색 조건 적용
    const countQuery = client
      .select({ count: count() })
      .from(userServiceSchema.blacklists)
      .leftJoin(userServiceSchema.users, eq(userServiceSchema.blacklists.userId, userServiceSchema.users.id))
      .where(whereClause);

    const [{ count: total }] = await countQuery;

    const dataQuery = client
      .select({
        id: userServiceSchema.blacklists.id,
        userId: userServiceSchema.blacklists.userId,
        reason: userServiceSchema.blacklists.reason,
        internalNote: userServiceSchema.blacklists.internalNote,
        createdBy: userServiceSchema.blacklists.createdBy,
        createdAt: userServiceSchema.blacklists.createdAt,
        updatedAt: userServiceSchema.blacklists.updatedAt,
        deletedAt: userServiceSchema.blacklists.deletedAt,
        deletedBy: userServiceSchema.blacklists.deletedBy,
        user: {
          username: userServiceSchema.users.username,
          nickname: userServiceSchema.users.nickname,
          email: userServiceSchema.users.email,
        },
      })
      .from(userServiceSchema.blacklists)
      .leftJoin(userServiceSchema.users, eq(userServiceSchema.blacklists.userId, userServiceSchema.users.id))
      .where(whereClause)
      .limit(limit)
      .offset(offset);

    const data = await dataQuery;

    return { data, total, page, limit };
  }

  async getBlacklistByUserId(userId: string, tx?: DbTransaction): Promise<BlacklistsResponseDto | null> {
    const client = this.getClient(tx);
    const [blacklist] = await client
      .select()
      .from(userServiceSchema.blacklists)
      .where(eq(userServiceSchema.blacklists.userId, userId));

    if (!blacklist) {
      return null;
    }

    return blacklist;
  }

  async createBlacklist(blacklistsCreateDto: BlacklistsCreateDto, adminId: string, tx?: DbTransaction): Promise<void> {
    const client = this.getClient(tx);
    // 해당 블랙리스트에있는 사용자가 있는지 조회
    const existingBlacklist = await this.getBlacklistByUserId(blacklistsCreateDto.userId, tx);

    // 이미 활성화된 블랙리스트가 있는 경우 에러
    if (existingBlacklist && !existingBlacklist.deletedAt) {
      throw new BlacklistsAlreadyExistsException('해당 유저의 블랙리스트 정보가 이미 존재합니다.');
    }

    // 이전에 해제된 블랙리스트가 있는 경우 재활성화
    if (existingBlacklist && existingBlacklist.deletedAt) {
      await client
        .update(userServiceSchema.blacklists)
        .set({
          reason: blacklistsCreateDto.reason,
          internalNote: blacklistsCreateDto.internalNote ?? null,
          createdBy: adminId,
          deletedAt: null,
          deletedBy: null,
          updatedAt: new Date(),
        })
        .where(eq(userServiceSchema.blacklists.userId, blacklistsCreateDto.userId));
      return;
    }

    await client
      .insert(userServiceSchema.blacklists)
      .values({ ...blacklistsCreateDto, createdBy: adminId })
      .returning();

    return;
  }

  async deleteBlacklist(userId: string, adminId: string, tx?: DbTransaction): Promise<void> {
    const client = this.getClient(tx);

    const existingBlacklist = await this.getBlacklistByUserId(userId, tx);

    if (!existingBlacklist) {
      throw new BlacklistsNotFoundException('해당 블랙리스트 정보를 찾을 수 없습니다.');
    }
    await client
      .update(userServiceSchema.blacklists)
      .set({ deletedAt: new Date(), deletedBy: adminId, updatedAt: new Date() })
      .where(eq(userServiceSchema.blacklists.userId, userId));

    return;
  }
}
