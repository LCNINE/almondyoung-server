import { DbService, InjectDb } from '@app/db';
import { Injectable, Logger } from '@nestjs/common';
import {
  userServiceEnums,
  userServiceSchema,
  type UserServiceSchema,
} from 'apps/user-service/database/drizzle/schema';
import { and, eq, sql } from 'drizzle-orm';
import { DbTransaction } from '../../commons/types';

@Injectable()
export class TokensService {
  private readonly logger = new Logger(TokensService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
  ) {}

  private getClient(tx?: DbTransaction) {
    return tx ?? this.dbService.db;
  }

  /**
   * 액세스 토큰을 DB에서 조회하고 유효성을 검증합니다.
   * @param userId 사용자 ID
   * @param tokenValue 토큰 값
   * @param tx 트랜잭션 객체 (선택)
   * @returns 유효한 토큰 정보
   * @throws Error 토큰이 유효하지 않은 경우
   */
  async validateAccessToken(
    userId: string,
    tokenValue: string,
    tx?: DbTransaction,
  ) {
    const client = this.getClient(tx);

    const [token] = await client
      .select()
      .from(userServiceSchema.tokens)
      .where(
        and(
          eq(userServiceSchema.tokens.userId, userId),
          eq(userServiceSchema.tokens.value, tokenValue),
          eq(
            userServiceSchema.tokens.type,
            userServiceEnums.tokenTypeEnum.enumValues[0], // 'access'
          ),
        ),
      )
      .limit(1);

    if (!token) {
      throw new Error('Token not found');
    }

    // 토큰이 revoke 되었는지 확인
    if (token.isRevoked) {
      throw new Error('Token revoked');
    }

    // 토큰이 만료되었는지 확인
    const now = new Date();
    if (token.expiresAt < now) {
      throw new Error('Token expired');
    }

    return token;
  }

  /**
   * 리프레시 토큰을 DB에서 조회하고 유효성을 검증합니다.
   * @param userId 사용자 ID
   * @param tokenValue 토큰 값
   * @param tx 트랜잭션 객체 (선택)
   * @returns 유효한 토큰 정보
   * @throws Error 토큰이 유효하지 않은 경우
   */
  async validateRefreshToken(
    userId: string,
    tokenValue: string,
    tx?: DbTransaction,
  ) {
    const client = this.getClient(tx);

    const [token] = await client
      .select()
      .from(userServiceSchema.tokens)
      .where(
        and(
          eq(userServiceSchema.tokens.userId, userId),
          eq(userServiceSchema.tokens.value, tokenValue),
          eq(
            userServiceSchema.tokens.type,
            userServiceEnums.tokenTypeEnum.enumValues[1], // 'refresh'
          ),
        ),
      )
      .limit(1);

    if (!token) {
      throw new Error('Refresh token not found');
    }

    // 토큰이 revoke 되었는지 확인
    if (token.isRevoked) {
      throw new Error('Refresh token revoked');
    }

    // 토큰이 만료되었는지 확인
    const now = new Date();
    if (token.expiresAt < now) {
      throw new Error('Refresh token expired');
    }

    return token;
  }

  /**
   * 특정 타입의 토큰을 조회합니다.
   * @param userId 사용자 ID
   * @param tokenType 토큰 타입
   * @param tx 트랜잭션 객체 (선택)
   * @returns 토큰 정보 또는 null
   */
  async findTokenByUserIdAndType(
    userId: string,
    tokenType: 'access' | 'refresh' | 'verification',
    tx?: DbTransaction,
  ) {
    const client = this.getClient(tx);

    const [token] = await client
      .select()
      .from(userServiceSchema.tokens)
      .where(
        and(
          eq(userServiceSchema.tokens.userId, userId),
          eq(userServiceSchema.tokens.type, tokenType),
        ),
      )
      .limit(1);

    return token || null;
  }

  /**
   * 토큰을 무효화(revoke)합니다.
   * @param userId 사용자 ID
   * @param tokenType 토큰 타입
   * @param tx 트랜잭션 객체 (선택)
   */
  async revokeToken(
    userId: string,
    tokenType: 'access' | 'refresh' | 'verification',
    tx?: DbTransaction,
  ) {
    const client = this.getClient(tx);

    await client
      .update(userServiceSchema.tokens)
      .set({
        isRevoked: true,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userServiceSchema.tokens.userId, userId),
          eq(userServiceSchema.tokens.type, tokenType),
        ),
      );

    this.logger.log(`Token revoked: userId=${userId}, tokenType=${tokenType}`);
  }

  /**
   * 사용자의 모든 토큰을 무효화합니다.
   * @param userId 사용자 ID
   * @param tx 트랜잭션 객체 (선택)
   */
  async revokeAllTokens(userId: string, tx?: DbTransaction) {
    const client = this.getClient(tx);

    await client
      .update(userServiceSchema.tokens)
      .set({
        isRevoked: true,
        updatedAt: new Date(),
      })
      .where(eq(userServiceSchema.tokens.userId, userId));

    this.logger.log(`All tokens revoked for userId=${userId}`);
  }

  /**
   * 토큰을 삭제합니다.
   * @param userId 사용자 ID
   * @param tokenType 토큰 타입
   * @param tx 트랜잭션 객체 (선택)
   */
  async deleteToken(
    userId: string,
    tokenType: 'access' | 'refresh' | 'verification',
    tx?: DbTransaction,
  ) {
    const client = this.getClient(tx);

    await client
      .delete(userServiceSchema.tokens)
      .where(
        and(
          eq(userServiceSchema.tokens.userId, userId),
          eq(userServiceSchema.tokens.type, tokenType),
        ),
      );

    this.logger.log(`Token deleted: userId=${userId}, tokenType=${tokenType}`);
  }

  /**
   * 사용자의 모든 토큰을 삭제합니다.
   * @param userId 사용자 ID
   * @param tx 트랜잭션 객체 (선택)
   */
  async deleteAllTokens(userId: string, tx?: DbTransaction) {
    const client = this.getClient(tx);

    await client
      .delete(userServiceSchema.tokens)
      .where(eq(userServiceSchema.tokens.userId, userId));

    this.logger.log(`All tokens deleted for userId=${userId}`);
  }

  /**
   * 액세스 토큰을 저장합니다. (기존 토큰이 있으면 삭제 후 저장)
   * @param userId 사용자 ID
   * @param tokenValue 토큰 값
   * @param scopes 스코프 배열
   * @param expiresAt 만료 시간
   * @param tx 트랜잭션 객체 (선택)
   */
  async saveAccessToken(
    userId: string,
    tokenValue: string,
    scopes: string[],
    expiresAt: Date,
    tx?: DbTransaction,
  ) {
    const client = this.getClient(tx);

    // UPSERT: 기존 토큰이 있으면 업데이트, 없으면 삽입
    await client
      .insert(userServiceSchema.tokens)
      .values({
        type: userServiceEnums.tokenTypeEnum.enumValues[0],
        userId,
        value: tokenValue,
        scopes: scopes.join(','),
        expiresAt,
      })
      .onConflictDoUpdate({
        target: [
          userServiceSchema.tokens.userId,
          userServiceSchema.tokens.type,
        ],
        set: {
          value: tokenValue,
          scopes: scopes.join(','),
          expiresAt,
          updatedAt: new Date(),
        },
      });

    this.logger.log(`Access token saved for userId=${userId}`);
  }

  /**
   * 리프레시 토큰을 저장합니다. (기존 토큰이 있으면 삭제 후 저장)
   * @param userId 사용자 ID
   * @param tokenValue 토큰 값
   * @param scopes 스코프 배열
   * @param expiresAt 만료 시간
   * @param tx 트랜잭션 객체 (선택)
   */
  async saveRefreshToken(
    userId: string,
    tokenValue: string,
    scopes: string[],
    expiresAt: Date,
    tx?: DbTransaction,
  ) {
    const client = this.getClient(tx);

    // UPSERT: 기존 토큰이 있으면 업데이트, 없으면 삽입
    await client
      .insert(userServiceSchema.tokens)
      .values({
        type: userServiceEnums.tokenTypeEnum.enumValues[1],
        userId,
        value: tokenValue,
        scopes: scopes.join(','),
        expiresAt,
      })
      .onConflictDoUpdate({
        target: [
          userServiceSchema.tokens.userId,
          userServiceSchema.tokens.type,
        ],
        set: {
          value: tokenValue,
          scopes: scopes.join(','),
          expiresAt,
          updatedAt: new Date(),
        },
      });

    this.logger.log(`Refresh token saved for userId=${userId}`);
  }

  /**
   * 인증(verification) 토큰을 저장합니다.
   * @param userId 사용자 ID
   * @param tokenValue 토큰 값
   * @param expiresAt 만료 시간
   * @param tx 트랜잭션 객체 (선택)
   */
  async saveVerificationToken(
    userId: string,
    tokenValue: string,
    expiresAt: Date,
    tx?: DbTransaction,
  ) {
    const client = this.getClient(tx);

    // upsert: 존재하면 업데이트, 없으면 삽입
    await client
      .insert(userServiceSchema.tokens)
      .values({
        type: userServiceEnums.tokenTypeEnum.enumValues[2],
        userId,
        value: tokenValue,
        scopes: '',
        expiresAt,
      })
      .onConflictDoUpdate({
        target: [
          userServiceSchema.tokens.userId,
          userServiceSchema.tokens.type,
        ],
        set: {
          value: tokenValue,
          expiresAt: expiresAt,
          updatedAt: sql`now()`,
        },
      });

    this.logger.log(`Verification token saved for userId=${userId}`);
  }

  /**
   * 토큰 값으로 인증 토큰을 삭제합니다.
   * @param tokenValue 토큰 값
   * @param tx 트랜잭션 객체 (선택)
   */
  async deleteTokenByValue(tokenValue: string, tx?: DbTransaction) {
    const client = this.getClient(tx);

    await client
      .delete(userServiceSchema.tokens)
      .where(eq(userServiceSchema.tokens.value, tokenValue));

    this.logger.log(`Token deleted by value`);
  }
}
