import { DbService, InjectDb } from '@app/db';
import { InjectStreamPublisher, StreamPublisher } from '@app/events';
import { HttpService } from '@nestjs/axios';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { firstValueFrom } from 'rxjs';
import {
  cafe24Links,
  cafe24Snapshots,
  cafe24Tokens,
  profiles,
  users,
  type UserServiceSchema,
} from '../../../database/drizzle/schema';
import type { UserEvents } from '@packages/event-contracts/streams';
import { DbTransaction } from '../../commons/types';

export interface Cafe24SignupPrefill {
  email: string | null;
  username: string | null;
  birthday: string | null;
  phoneNumber: string | null;
}

export interface Cafe24SignupBootstrapResult {
  memberId: string | null;
  memberName: string;
  prefillAvailable: boolean;
  prefill: Cafe24SignupPrefill;
}

type MigrationKey = 'email' | 'name' | 'birthday' | 'phone';
type MigrationStatus = 'synced' | 'out_of_sync' | 'missing';

interface MigrationItemResult {
  key: MigrationKey;
  status: MigrationStatus;
  cafe24Value: string | null;
  userValue: string | null;
}

@Injectable()
export class Cafe24LinkService {
  private readonly logger = new Logger(Cafe24LinkService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @InjectStreamPublisher('users.events.v1')
    private readonly eventPublisher: StreamPublisher<UserEvents>,
  ) {}

  private getClient(tx?: DbTransaction) {
    return tx ?? this.dbService.db;
  }

  private getCafe24MallId() {
    return 'lcnine';
  }

  private decodeTokenPayload(encryptedIdToken: string) {
    const serviceKey = this.configService.get<string>('CAFE24_SERVICE_KEY');
    if (!serviceKey) {
      throw new Error('CAFE24_SERVICE_KEY 환경변수가 필요합니다.');
    }

    try {
      return this.decodeEncryptedIdToken(encryptedIdToken, serviceKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Cafe24 token decode failed: ${message}`);
      throw new BadRequestException('암호화 id 토큰이 유효하지 않습니다.');
    }
  }

  async issueSignupBootstrapData(encryptedIdToken: string, tx?: DbTransaction): Promise<Cafe24SignupBootstrapResult> {
    try {
      const privacy = await this.fetchMemberPrivacyByEncryptedIdToken(encryptedIdToken, tx);

      return {
        memberId: privacy.memberId,
        memberName: privacy.memberName,
        prefillAvailable: true,
        prefill: {
          email: privacy.normalized.email,
          username: privacy.normalized.name,
          birthday: privacy.normalized.birthDate ? this.formatBirthDateForSignup(privacy.normalized.birthDate) : null,
          phoneNumber: privacy.normalized.phoneNumber,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Cafe24 privacy prefill fetch failed during signup bootstrap: ${message}`);

      return {
        memberId: null,
        memberName: '',
        prefillAvailable: false,
        prefill: {
          email: null,
          username: null,
          birthday: null,
          phoneNumber: null,
        },
      };
    }
  }

  async fetchMemberInfo(encryptedIdToken: string, _tx?: DbTransaction) {
    const payload = this.decodeTokenPayload(encryptedIdToken);
    const memberId = this.extractMemberId(payload);
    if (!memberId) {
      throw new BadRequestException('회원 ID를 확인할 수 없습니다.');
    }

    return {
      memberId,
      memberName: (payload['member_name'] as string | undefined) ?? null,
    };
  }

  async getMigrationItems(userId: string, tx?: DbTransaction) {
    const keys: MigrationKey[] = ['email', 'name', 'birthday', 'phone'];
    const results = await Promise.all(keys.map((key) => this.lookupMigrationItem(userId, key, tx)));
    return results;
  }

  async linkCafe24Account(userId: string, encryptedIdToken: string, tx?: DbTransaction) {
    const client = this.getClient(tx);
    const payload = this.decodeTokenPayload(encryptedIdToken);
    const cafe24MemberId = this.extractMemberId(payload);
    if (!cafe24MemberId) {
      throw new BadRequestException('Cafe24 회원 ID가 없습니다.');
    }
    const mallId = this.getCafe24MallId();

    const [existingByMember] = await client
      .select()
      .from(cafe24Links)
      .where(
        and(
          eq(cafe24Links.mallId, mallId),
          eq(cafe24Links.cafe24MemberId, cafe24MemberId),
          isNull(cafe24Links.unlinkedAt),
        ),
      )
      .limit(1);

    if (existingByMember && existingByMember.cafe24MemberId === cafe24MemberId && existingByMember.userId !== userId) {
      throw new BadRequestException('이미 다른 계정에 연결된 Cafe24 계정입니다.');
    }

    const now = new Date();
    const [link] = await client
      .insert(cafe24Links)
      .values({
        userId,
        mallId,
        cafe24MemberId,
        linkedAt: now,
        updatedAt: now,
      } as typeof cafe24Links.$inferInsert)
      .onConflictDoUpdate({
        target: [cafe24Links.userId, cafe24Links.mallId],
        targetWhere: isNull(cafe24Links.unlinkedAt),
        set: {
          cafe24MemberId,
          linkedAt: now,
          updatedAt: now,
        },
      })
      .returning();

    // 이메일 조회 후 이벤트 발행
    const [userRow] = await client.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);

    if (userRow?.email) {
      try {
        await this.eventPublisher.publishEvent({
          eventType: 'Cafe24Linked',
          aggregateId: userId,
          payload: {
            userId,
            cafe24MemberId,
            mallId,
            email: userRow.email,
            linkedAt: now.toISOString(),
          },
        });
      } catch (err) {
        this.logger.error(`Failed to publish Cafe24Linked event for userId=${userId}`, err?.message);
      }
    }

    return link;
  }

  async lookupMigrationItem(userId: string, key: MigrationKey, tx?: DbTransaction): Promise<MigrationItemResult> {
    const client = this.getClient(tx);
    const link = await this.getCafe24LinkByUserId(userId, tx);
    const snapshot = await this.getOrFetchSnapshot(link, tx);
    const userData = await this.getUserAndProfile(userId, client);

    const cafe24Value = this.getSnapshotValue(snapshot, key);
    const userValue = this.getUserValue(userData, key);

    if (!cafe24Value) {
      return { key, status: 'missing', cafe24Value: null, userValue };
    }

    const isSynced = this.compareValues(key, userValue, cafe24Value);
    return {
      key,
      status: isSynced ? 'synced' : 'out_of_sync',
      cafe24Value,
      userValue,
    };
  }

  async migrateItem(userId: string, key: MigrationKey, tx?: DbTransaction): Promise<MigrationItemResult> {
    const client = this.getClient(tx);
    const link = await this.getCafe24LinkByUserId(userId, tx);
    const snapshot = await this.getOrFetchSnapshot(link, tx);
    const cafe24Value = this.getSnapshotValue(snapshot, key);

    if (!cafe24Value) {
      throw new BadRequestException('이관할 데이터가 없습니다.');
    }

    await this.applyMigration(userId, key, cafe24Value, client);
    return this.lookupMigrationItem(userId, key, tx);
  }

  private async getCafe24AccessToken(mallId: string, tx?: DbTransaction) {
    const client = this.getClient(tx);
    const [token] = await client.select().from(cafe24Tokens).where(eq(cafe24Tokens.mallId, mallId)).limit(1);

    if (!token) {
      throw new BadRequestException('Cafe24 access token이 없습니다.');
    }

    if (token.expiresAt < new Date()) {
      throw new BadRequestException('Cafe24 access token이 만료되었습니다.');
    }

    return token.accessToken;
  }

  private async getCafe24LinkByUserId(userId: string, tx?: DbTransaction) {
    const client = this.getClient(tx);
    const [link] = await client
      .select()
      .from(cafe24Links)
      .where(and(eq(cafe24Links.userId, userId), isNull(cafe24Links.unlinkedAt)))
      .limit(1);

    if (!link) {
      throw new BadRequestException('연결된 Cafe24 계정이 없습니다.');
    }

    return link;
  }

  private async getOrFetchSnapshot(link: typeof cafe24Links.$inferSelect, tx?: DbTransaction) {
    const client = this.getClient(tx);
    const [existing] = await client.select().from(cafe24Snapshots).where(eq(cafe24Snapshots.linkId, link.id)).limit(1);

    if (existing) {
      return existing;
    }

    const snapshot = await this.fetchPrivacySnapshot(link, tx);
    return snapshot;
  }

  async unlinkCafe24Account(userId: string, tx?: DbTransaction) {
    const client = this.getClient(tx);
    const now = new Date();

    const [link] = await client
      .select()
      .from(cafe24Links)
      .where(and(eq(cafe24Links.userId, userId), isNull(cafe24Links.unlinkedAt)))
      .limit(1);

    if (!link) {
      throw new BadRequestException('연결된 Cafe24 계정이 없습니다.');
    }

    await client.update(cafe24Links).set({ unlinkedAt: now, updatedAt: now }).where(eq(cafe24Links.id, link.id));

    // 이메일 조회 후 이벤트 발행
    const [userRow] = await client.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);

    if (userRow?.email) {
      try {
        await this.eventPublisher.publishEvent({
          eventType: 'Cafe24Unlinked',
          aggregateId: userId,
          payload: {
            userId,
            cafe24MemberId: link.cafe24MemberId,
            mallId: link.mallId,
            email: userRow.email,
            unlinkedAt: now.toISOString(),
          },
        });
      } catch (err) {
        this.logger.error(`Failed to publish Cafe24Unlinked event for userId=${userId}`, err?.message);
      }
    }

    return link;
  }

  async getLinkInfoByCafe24MemberId(mallId: string, cafe24MemberId: string) {
    const [row] = await this.dbService.db
      .select({ userId: cafe24Links.userId, email: users.email })
      .from(cafe24Links)
      .innerJoin(users, eq(cafe24Links.userId, users.id))
      .where(
        and(
          eq(cafe24Links.mallId, mallId),
          eq(cafe24Links.cafe24MemberId, cafe24MemberId),
          isNull(cafe24Links.unlinkedAt),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  async getAllLinksByMallId(mallId: string) {
    const rows = await this.dbService.db
      .select({
        userId: cafe24Links.userId,
        cafe24MemberId: cafe24Links.cafe24MemberId,
        email: users.email,
      })
      .from(cafe24Links)
      .innerJoin(users, eq(cafe24Links.userId, users.id))
      .where(and(eq(cafe24Links.mallId, mallId), isNull(cafe24Links.unlinkedAt)));

    return rows;
  }

  async getLinkedCafe24Account(userId: string, tx?: DbTransaction) {
    const client = this.getClient(tx);
    const [link] = await client
      .select()
      .from(cafe24Links)
      .where(and(eq(cafe24Links.userId, userId), isNull(cafe24Links.unlinkedAt)))
      .limit(1);

    return link ?? null;
  }

  private async fetchPrivacySnapshot(link: typeof cafe24Links.$inferSelect, tx?: DbTransaction) {
    const accessToken = await this.getCafe24AccessToken(link.mallId, tx);
    const apiVersion = this.configService.get<string>('CAFE24_API_VERSION') ?? '2025-12-01';
    const encodedMemberId = encodeURIComponent(link.cafe24MemberId);
    const url = `https://${link.mallId}.cafe24api.com/api/v2/admin/customersprivacy/${encodedMemberId}`;

    const response = await firstValueFrom(
      this.httpService.get(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Cafe24-Api-Version': apiVersion,
        },
      }),
    );

    const rawData = response.data ?? {};
    const normalized = this.normalizePrivacyData(rawData);
    const now = new Date();

    const client = this.getClient(tx);
    const [snapshot] = await client
      .insert(cafe24Snapshots)
      .values({
        linkId: link.id,
        email: normalized.email,
        name: normalized.name,
        birthDate: normalized.birthDate,
        phoneNumber: normalized.phoneNumber,
        rawData,
        fetchedAt: now,
        updatedAt: now,
      } as typeof cafe24Snapshots.$inferInsert)
      .onConflictDoUpdate({
        target: cafe24Snapshots.linkId,
        set: {
          email: normalized.email,
          name: normalized.name,
          birthDate: normalized.birthDate,
          phoneNumber: normalized.phoneNumber,
          rawData,
          fetchedAt: now,
          updatedAt: now,
        },
      })
      .returning();

    return snapshot;
  }

  private async fetchMemberPrivacyByEncryptedIdToken(encryptedIdToken: string, tx?: DbTransaction) {
    const resolvedMallId = this.getCafe24MallId();
    const payload = this.decodeTokenPayload(encryptedIdToken);

    const memberId = this.extractMemberId(payload);
    if (!memberId) {
      throw new BadRequestException('회원 ID를 확인할 수 없습니다.');
    }

    const accessToken = await this.getCafe24AccessToken(resolvedMallId, tx);
    const apiVersion = this.configService.get<string>('CAFE24_API_VERSION') ?? '2025-12-01';
    const encodedMemberId = encodeURIComponent(memberId);
    const url = `https://${resolvedMallId}.cafe24api.com/api/v2/admin/customersprivacy/${encodedMemberId}`;

    const response = await firstValueFrom(
      this.httpService.get(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Cafe24-Api-Version': apiVersion,
        },
      }),
    );

    const data = response.data ?? {};
    const memberName = this.extractMemberName(data);
    const normalized = this.normalizePrivacyData(data);

    return {
      memberId,
      memberName,
      normalized,
    };
  }

  private normalizePrivacyData(data: Record<string, any>) {
    const customer = data?.customersprivacy ?? {};
    const email = customer?.email ?? null;
    const name = customer?.name ?? null;
    const phone = customer?.cellphone ?? customer?.phone ?? null;
    const birth = customer?.birthday ?? null;

    return {
      email: typeof email === 'string' ? email : null,
      name: typeof name === 'string' ? name : null,
      phoneNumber: typeof phone === 'string' ? phone : null,
      birthDate: this.parseDateValue(birth),
    };
  }

  private formatBirthDateForSignup(value: Date) {
    return value.toISOString().slice(0, 10).replace(/-/g, '');
  }

  private parseDateValue(value: unknown) {
    if (!value) {
      return null;
    }

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (/^\\d{8}$/.test(trimmed)) {
        const year = trimmed.slice(0, 4);
        const month = trimmed.slice(4, 6);
        const day = trimmed.slice(6, 8);
        const parsed = new Date(`${year}-${month}-${day}T00:00:00Z`);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
      }

      const parsed = new Date(trimmed);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    return null;
  }

  private async getUserAndProfile(userId: string, client: ReturnType<Cafe24LinkService['getClient']>) {
    const [row] = await client
      .select({
        user: users,
        profile: profiles,
      })
      .from(users)
      .leftJoin(profiles, eq(users.id, profiles.userId))
      .where(eq(users.id, userId))
      .limit(1);

    if (!row) {
      throw new BadRequestException('사용자를 찾을 수 없습니다.');
    }

    return row;
  }

  private getSnapshotValue(snapshot: typeof cafe24Snapshots.$inferSelect, key: MigrationKey) {
    switch (key) {
      case 'email':
        return snapshot.email ?? null;
      case 'name':
        return snapshot.name ?? null;
      case 'birthday':
        return snapshot.birthDate ? snapshot.birthDate.toISOString().slice(0, 10) : null;
      case 'phone':
        return snapshot.phoneNumber ?? null;
      default:
        return null;
    }
  }

  private getUserValue(
    data: { user: typeof users.$inferSelect; profile: typeof profiles.$inferSelect | null },
    key: MigrationKey,
  ) {
    switch (key) {
      case 'email':
        return data.user.email ?? null;
      case 'name':
        return data.user.username ?? null;
      case 'birthday':
        return data.profile?.birthDate ? data.profile.birthDate.toISOString().slice(0, 10) : null;
      case 'phone':
        return data.profile?.phoneNumber ?? null;
      default:
        return null;
    }
  }

  private compareValues(key: MigrationKey, userValue: string | null, cafe24Value: string | null) {
    if (!cafe24Value) {
      return false;
    }

    if (!userValue) {
      return false;
    }

    switch (key) {
      case 'email':
        return userValue.trim().toLowerCase() === cafe24Value.trim().toLowerCase();
      case 'name':
        return userValue.trim() === cafe24Value.trim();
      case 'birthday':
        return userValue.slice(0, 10) === cafe24Value.slice(0, 10);
      case 'phone':
        return this.normalizePhone(userValue) === this.normalizePhone(cafe24Value);
      default:
        return false;
    }
  }

  private normalizePhone(value: string) {
    return value.replace(/\\D/g, '');
  }

  private async applyMigration(
    userId: string,
    key: MigrationKey,
    cafe24Value: string,
    client: ReturnType<Cafe24LinkService['getClient']>,
  ) {
    switch (key) {
      case 'email': {
        await client.update(users).set({ email: cafe24Value, updatedAt: new Date() }).where(eq(users.id, userId));
        return;
      }
      case 'name': {
        await client.update(users).set({ username: cafe24Value, updatedAt: new Date() }).where(eq(users.id, userId));
        return;
      }
      case 'birthday': {
        const birthDate = this.parseDateValue(cafe24Value);
        if (!birthDate) {
          throw new BadRequestException('생년월일 형식이 올바르지 않습니다.');
        }
        await client.insert(profiles).values({ userId, birthDate }).onConflictDoUpdate({
          target: profiles.userId,
          set: { birthDate },
        });
        return;
      }
      case 'phone': {
        await client
          .insert(profiles)
          .values({ userId, phoneNumber: cafe24Value })
          .onConflictDoUpdate({
            target: profiles.userId,
            set: { phoneNumber: cafe24Value },
          });
        return;
      }
      default:
        return;
    }
  }

  private decodeEncryptedIdToken(token: string, serviceKey: string): Record<string, unknown> {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Wrong number of segments');
    }

    const [headerB64, payloadB64, signatureB64] = parts;
    const headerJson = this.base64UrlDecode(headerB64).toString('utf8');
    const payloadJson = this.base64UrlDecode(payloadB64).toString('utf8');
    const header = JSON.parse(headerJson) as Record<string, unknown>;
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    const signature = this.base64UrlDecode(signatureB64);

    const algorithm = header.alg;
    if (algorithm && algorithm !== 'HS512') {
      throw new Error('Unexpected JWT algorithm');
    }

    const data = `${headerB64}.${payloadB64}`;
    const expected = createHmac('sha512', serviceKey).update(data).digest();

    if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) {
      throw new Error('Signature verification failed');
    }

    return payload;
  }

  private base64UrlDecode(value: string) {
    let normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padding = normalized.length % 4;
    if (padding) {
      normalized += '='.repeat(4 - padding);
    }
    return Buffer.from(normalized, 'base64');
  }

  private extractMemberId(payload: Record<string, unknown>) {
    const memberId = payload.member_id;
    if (typeof memberId === 'string') {
      return memberId;
    }

    const userId = payload.user_id;
    if (typeof userId === 'string') {
      return userId;
    }

    const sub = payload.sub;
    if (typeof sub === 'string') {
      return sub;
    }

    return null;
  }

  private extractMemberName(data: Record<string, any>) {
    const customer = data?.customersprivacy ?? data?.customer ?? data?.customer_privacy ?? data?.data;
    const candidate =
      customer?.name ||
      customer?.member_name ||
      customer?.user_name ||
      data?.name ||
      data?.member_name ||
      data?.user_name;

    if (typeof candidate === 'string') {
      return candidate;
    }

    return '';
  }
}
