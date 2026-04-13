import { DbService, InjectDb } from '@app/db';
import { InjectStreamPublisher, StreamPublisher } from '@app/events';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserEvents } from '@packages/event-contracts/streams';
import {
  userServiceSchema,
  type UserServiceSchema,
} from 'apps/user-service/database/drizzle/schema';
import { and, eq } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { DbTransaction, ProviderType } from '../../commons/types';
import { LinkedIdentityDto, LinkedIdentitiesResponseDto } from './dto/identity-list.dto';
import { LinkingStatePayload } from './dto/link-identity.dto';

const LINKING_STATE_EXPIRATION = 5 * 60; // 5분 (초)
const SUPPORTED_PROVIDERS: ProviderType[] = [ProviderType.KAKAO, ProviderType.NAVER];

interface SocialProfile {
  name: string;
  email: string;
  providerId: string;
}

@Injectable()
export class AccountLinkingService {
  private readonly logger = new Logger(AccountLinkingService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectStreamPublisher('users.events.v1')
    private readonly eventPublisher: StreamPublisher<UserEvents>,
  ) {}

  private getClient(tx?: DbTransaction) {
    return tx ?? this.dbService.db;
  }

  private async inTx<T>(fn: (tx: DbTransaction) => Promise<T>, tx?: DbTransaction): Promise<T> {
    return tx ? fn(tx) : this.dbService.db.transaction(fn);
  }

  /**
   * OAuth state 토큰 생성 (CSRF 방지)
   */
  async generateLinkingState(userId: string, redirectTo?: string): Promise<string> {
    const nonce = randomBytes(16).toString('hex');

    const payload: Omit<LinkingStatePayload, 'iat' | 'exp'> = {
      userId,
      nonce,
      purpose: 'link',
      redirectTo,
    };

    const state = await this.jwtService.signAsync(payload, {
      secret: this.configService.getOrThrow<string>('AUTH_SECRET'),
      expiresIn: LINKING_STATE_EXPIRATION,
    });

    this.logger.debug(`Linking state generated for user: ${userId}, redirectTo: ${redirectTo}`);
    return state;
  }

  /**
   * OAuth state 토큰 검증
   */
  async verifyLinkingState(state: string): Promise<{ userId: string; redirectTo?: string }> {
    const payload = await this.jwtService.verifyAsync<LinkingStatePayload>(state, {
      secret: this.configService.getOrThrow<string>('AUTH_SECRET'),
    });

    if (payload.purpose !== 'link') {
      throw new Error('Invalid state token purpose');
    }

    return { userId: payload.userId, redirectTo: payload.redirectTo };
  }

  /**
   * 소셜 계정 연결
   */
  async linkSocialAccount(
    userId: string,
    provider: ProviderType,
    socialProfile: SocialProfile,
    tx?: DbTransaction,
  ): Promise<void> {
    return this.inTx(async (trx) => {
      // 1. 해당 providerId가 이미 다른 사용자에게 연결되어 있는지 확인 (계정 탈취 방지)
      const existingIdentity = await trx
        .select({
          id: userServiceSchema.userIdentities.id,
          userId: userServiceSchema.userIdentities.userId,
        })
        .from(userServiceSchema.userIdentities)
        .where(
          and(
            eq(userServiceSchema.userIdentities.provider, provider),
            eq(userServiceSchema.userIdentities.providerId, socialProfile.providerId),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]);

      if (existingIdentity) {
        if (existingIdentity.userId !== userId) {
          throw new Error('This social account is already linked to another user');
        }
        // 동일 사용자에게 이미 연결된 경우 정보 업데이트
        await trx
          .update(userServiceSchema.userIdentities)
          .set({
            providerData: {
              name: socialProfile.name,
              email: socialProfile.email,
            },
            updatedAt: new Date(),
          })
          .where(eq(userServiceSchema.userIdentities.id, existingIdentity.id));

        this.logger.log(`Social account updated for user: ${userId}, provider: ${provider}`);
        return;
      }

      // 2. 동일 사용자에게 같은 provider의 다른 계정이 연결되어 있는지 확인
      const existingUserIdentity = await trx
        .select({ id: userServiceSchema.userIdentities.id })
        .from(userServiceSchema.userIdentities)
        .where(
          and(
            eq(userServiceSchema.userIdentities.userId, userId),
            eq(userServiceSchema.userIdentities.provider, provider),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]);

      if (existingUserIdentity) {
        throw new Error(`You already have a ${provider} account linked`);
      }

      // 3. 새 identity 생성
      await trx.insert(userServiceSchema.userIdentities).values({
        userId,
        provider,
        providerId: socialProfile.providerId,
        providerData: {
          name: socialProfile.name,
          email: socialProfile.email,
        },
      });

      this.logger.log(`Social account linked for user: ${userId}, provider: ${provider}`);

      // 4. 이벤트 발행
      await this.eventPublisher.publishEvent({
        eventType: 'SocialIdentityLinked',
        aggregateId: userId,
        payload: {
          userId,
          provider,
          linkedAt: new Date().toISOString(),
        },
      });
    }, tx);
  }

  /**
   * 소셜 계정 연결 해제
   */
  async unlinkSocialAccount(userId: string, provider: ProviderType, tx?: DbTransaction): Promise<void> {
    return this.inTx(async (trx) => {
      // 1. 사용자의 인증 수단 확인 (마지막 인증 수단 삭제 방지)
      const [user] = await trx
        .select({
          password: userServiceSchema.users.password,
        })
        .from(userServiceSchema.users)
        .where(eq(userServiceSchema.users.id, userId))
        .limit(1);

      if (!user) {
        throw new Error('User not found');
      }

      const identities = await trx
        .select({ id: userServiceSchema.userIdentities.id })
        .from(userServiceSchema.userIdentities)
        .where(eq(userServiceSchema.userIdentities.userId, userId));

      // 비밀번호가 없고 identity가 1개뿐인 경우 삭제 불가
      if (!user.password && identities.length <= 1) {
        throw new Error('Cannot unlink the last authentication method');
      }

      // 2. identity 삭제
      const result = await trx
        .delete(userServiceSchema.userIdentities)
        .where(
          and(
            eq(userServiceSchema.userIdentities.userId, userId),
            eq(userServiceSchema.userIdentities.provider, provider),
          ),
        )
        .returning({ id: userServiceSchema.userIdentities.id });

      if (result.length === 0) {
        throw new Error(`No ${provider} account linked to unlink`);
      }

      this.logger.log(`Social account unlinked for user: ${userId}, provider: ${provider}`);

      // 3. 이벤트 발행
      await this.eventPublisher.publishEvent({
        eventType: 'SocialIdentityUnlinked',
        aggregateId: userId,
        payload: {
          userId,
          provider,
          unlinkedAt: new Date().toISOString(),
        },
      });
    }, tx);
  }

  /**
   * 연결된 소셜 계정 목록 조회
   */
  async getLinkedIdentities(userId: string, tx?: DbTransaction): Promise<LinkedIdentitiesResponseDto> {
    const client = this.getClient(tx);

    // 사용자 정보 조회
    const [user] = await client
      .select({
        password: userServiceSchema.users.password,
      })
      .from(userServiceSchema.users)
      .where(eq(userServiceSchema.users.id, userId))
      .limit(1);

    if (!user) {
      throw new Error('User not found');
    }

    // 연결된 identity 조회
    const identities = await client
      .select({
        provider: userServiceSchema.userIdentities.provider,
        providerId: userServiceSchema.userIdentities.providerId,
        providerData: userServiceSchema.userIdentities.providerData,
        createdAt: userServiceSchema.userIdentities.createdAt,
      })
      .from(userServiceSchema.userIdentities)
      .where(eq(userServiceSchema.userIdentities.userId, userId));

    const linkedProviders = identities.map((i) => i.provider);
    const availableProviders = SUPPORTED_PROVIDERS.filter((p) => !linkedProviders.includes(p));

    const linkedIdentities: LinkedIdentityDto[] = identities.map((identity) => {
      const providerData = identity.providerData as { name?: string; email?: string } | null;
      return {
        provider: identity.provider,
        providerId: identity.providerId,
        linkedAt: identity.createdAt,
        email: providerData?.email,
        name: providerData?.name,
      };
    });

    return {
      identities: linkedIdentities,
      hasPassword: !!user.password,
      availableProviders,
    };
  }
}
