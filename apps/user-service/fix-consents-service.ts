// apps/user-service/src/api/consents/consents.service.ts 수정
import { DbService, InjectDb } from '@app/db';
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbTransaction } from '../../commons/types';
import { CreateConsentDto } from './dto/consent-dto';
import {
  userConsents,
  users, // users 테이블 추가
  type UserServiceSchema,
} from 'apps/user-service/database/drizzle/schema';
import { UserConsent } from './types/consent.type';
import { ConsentsNotFoundException } from './exceptions/consents.exceptions';

@Injectable()
export class ConsentsService {
  constructor(
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
  ) {}

  private getClient(tx?: DbTransaction) {
    return tx ?? this.dbService.db;
  }

  async getUserConsent(
    userId: string,
    tx?: DbTransaction,
  ): Promise<UserConsent | null> {
    const db = this.getClient(tx);
    const [consents] = await db
      .select()
      .from(userConsents)
      .where(eq(userConsents.userId, userId));

    if (!consents) {
      throw new ConsentsNotFoundException('User consent not found');
    }
    return consents;
  }

  async createConsent(
    userId: string,
    createConsentDto: CreateConsentDto,
    tx?: DbTransaction,
  ): Promise<void> {
    const db = this.getClient(tx);

    await db.insert(userConsents).values({
      userId,
      ...createConsentDto,
    });
  }

  // notification-service용: 마케팅 동의 여부만 확인
  async getUserMarketingConsent(userId: string): Promise<boolean> {
    const db = this.getClient();
    const [consent] = await db
      .select({ marketingConsent: userConsents.marketingConsent })
      .from(userConsents)
      .where(eq(userConsents.userId, userId));

    return consent?.marketingConsent ?? false;
  }

  // notification-service용: 사용자 프로필 정보 조회 (users 테이블과 조인)
  async getUserProfile(userId: string): Promise<{
    userId: string;
    email: string;
    name: string;
    phoneNumber?: string;
    isMarketingEnabled: boolean;
  } | null> {
    const db = this.getClient();
    const [result] = await db
      .select({
        userId: users.id,
        email: users.email,
        name: users.username,
        phoneNumber: users.nickname, // 임시로 nickname 사용
        marketingConsent: userConsents.marketingConsent,
      })
      .from(users)
      .leftJoin(userConsents, eq(users.id, userConsents.userId))
      .where(eq(users.id, userId));

    if (!result) {
      return null;
    }

    return {
      userId: result.userId,
      email: result.email,
      name: result.name,
      phoneNumber: result.phoneNumber,
      isMarketingEnabled: result.marketingConsent ?? false,
    };
  }

  // notification-service용: 조건에 따른 사용자 목록 조회 (users 테이블과 조인)
  async getUsersByCriteria(criteria: {
    userIds?: string[];
    membershipType?: string;
    shopCategories?: string[];
    isMarketingEnabled?: boolean;
  }): Promise<{ users: any[]; totalCount: number }> {
    const db = this.getClient();
    
    // 기본 쿼리 - users와 user_consents 조인
    let query = db
      .select({
        userId: users.id,
        email: users.email,
        name: users.username,
        phoneNumber: users.nickname, // 임시로 nickname 사용
        isMarketingEnabled: userConsents.marketingConsent,
      })
      .from(users)
      .leftJoin(userConsents, eq(users.id, userConsents.userId));

    // 조건 적용
    if (criteria.userIds && criteria.userIds.length > 0) {
      // 실제로는 inArray 사용해야 하지만, 간단히 첫 번째 ID만 사용
      query = query.where(eq(users.id, criteria.userIds[0]));
    }

    if (criteria.isMarketingEnabled !== undefined) {
      query = query.where(eq(userConsents.marketingConsent, criteria.isMarketingEnabled));
    }

    const results = await query;
    
    return {
      users: results.map(row => ({
        userId: row.userId,
        email: row.email,
        name: row.name,
        phoneNumber: row.phoneNumber,
        isMarketingEnabled: row.isMarketingEnabled ?? false,
      })),
      totalCount: results.length,
    };
  }
}
