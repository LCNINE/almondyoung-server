import { DbService, InjectDb } from '@app/db';
import { HttpService } from '@nestjs/axios';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'crypto';
import { eq } from 'drizzle-orm';
import { firstValueFrom } from 'rxjs';
import {
  cafe24LinkTokens,
  cafe24Tokens,
  type UserServiceSchema,
} from '../../../database/drizzle/schema';
import { DbTransaction } from '../../commons/types';

interface IssueCafe24LinkTokenResult {
  cafe24LinkToken: string;
  expiresAt: Date;
}

@Injectable()
export class Cafe24LinkService {
  private readonly logger = new Logger(Cafe24LinkService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  private getClient(tx?: DbTransaction) {
    return tx ?? this.dbService.db;
  }

  async issueCafe24LinkToken(
    encryptedIdToken: string,
    mallId?: string,
    meta?: { ip?: string; userAgent?: string },
    tx?: DbTransaction,
  ): Promise<IssueCafe24LinkTokenResult> {
    const serviceKey = this.configService.get<string>('CAFE24_SERVICE_KEY');
    if (!serviceKey) {
      throw new Error('CAFE24_SERVICE_KEY 환경변수가 필요합니다.');
    }

    const resolvedMallId =
      mallId ?? this.configService.get<string>('CAFE24_MALL_ID');
    if (!resolvedMallId) {
      throw new BadRequestException('mallId가 필요합니다.');
    }

    let payload: Record<string, unknown>;
    try {
      payload = this.decodeEncryptedIdToken(encryptedIdToken, serviceKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Cafe24 token decode failed: ${message}`);
      throw new BadRequestException('암호화 id 토큰이 유효하지 않습니다.');
    }

    const cafe24MemberId = this.extractMemberId(payload);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.getTtlMs());
    const rawToken = this.generateToken();
    const tokenHash = this.hashValue(rawToken);
    const encryptedTokenHash = this.hashValue(encryptedIdToken);

    const client = this.getClient(tx);
    await client.insert(cafe24LinkTokens).values({
      tokenHash,
      encryptedTokenHash,
      mallId: resolvedMallId,
      cafe24MemberId,
      payload,
      expiresAt,
      lastError: null,
      ...meta,
    } as typeof cafe24LinkTokens.$inferInsert);

    return {
      cafe24LinkToken: rawToken,
      expiresAt,
    };
  }

  async fetchMemberInfo(
    encryptedIdToken: string,
    mallId?: string,
    tx?: DbTransaction,
  ) {
    const serviceKey = this.configService.get<string>('CAFE24_SERVICE_KEY');
    if (!serviceKey) {
      throw new Error('CAFE24_SERVICE_KEY 환경변수가 필요합니다.');
    }

    const resolvedMallId =
      mallId ?? this.configService.get<string>('CAFE24_MALL_ID');
    if (!resolvedMallId) {
      throw new BadRequestException('mallId가 필요합니다.');
    }

    let payload: Record<string, unknown>;
    try {
      payload = this.decodeEncryptedIdToken(encryptedIdToken, serviceKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Cafe24 token decode failed: ${message}`);
      throw new BadRequestException('암호화 id 토큰이 유효하지 않습니다.');
    }

    const cafe24MemberId = this.extractMemberId(payload);
    if (!cafe24MemberId) {
      throw new BadRequestException('회원 ID를 확인할 수 없습니다.');
    }

    const accessToken = await this.getCafe24AccessToken(resolvedMallId, tx);
    const apiVersion =
      this.configService.get<string>('CAFE24_API_VERSION') ?? '2025-12-01';
    const encodedMemberId = encodeURIComponent(cafe24MemberId);
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

    return {
      memberId: cafe24MemberId,
      memberName,
    };
  }

  async consumeCafe24LinkToken(
    cafe24LinkToken: string,
    tx?: DbTransaction,
  ) {
    const tokenHash = this.hashValue(cafe24LinkToken);
    const now = new Date();
    const client = this.getClient(tx);

    const [token] = await client
      .select()
      .from(cafe24LinkTokens)
      .where(eq(cafe24LinkTokens.tokenHash, tokenHash))
      .limit(1);

    if (!token) {
      throw new BadRequestException('유효하지 않은 토큰입니다.');
    }

    if (token.usedAt) {
      throw new BadRequestException('이미 사용된 토큰입니다.');
    }

    if (token.expiresAt < now) {
      throw new BadRequestException('만료된 토큰입니다.');
    }

    await client
      .update(cafe24LinkTokens)
      .set({ usedAt: now, updatedAt: now })
      .where(eq(cafe24LinkTokens.id, token.id));

    return token;
  }

  private async getCafe24AccessToken(mallId: string, tx?: DbTransaction) {
    const client = this.getClient(tx);
    const [token] = await client
      .select()
      .from(cafe24Tokens)
      .where(eq(cafe24Tokens.mallId, mallId))
      .limit(1);

    if (!token) {
      throw new BadRequestException('Cafe24 access token이 없습니다.');
    }

    if (token.expiresAt < new Date()) {
      throw new BadRequestException('Cafe24 access token이 만료되었습니다.');
    }

    return token.accessToken;
  }

  private decodeEncryptedIdToken(
    token: string,
    serviceKey: string,
  ): Record<string, unknown> {
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
    const expected = createHmac('sha512', serviceKey)
      .update(data)
      .digest();

    if (
      signature.length !== expected.length ||
      !timingSafeEqual(signature, expected)
    ) {
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

  private hashValue(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private generateToken() {
    return randomBytes(32).toString('base64url');
  }

  private getTtlMs() {
    const raw = this.configService.get<string>('CAFE24_LINK_TOKEN_TTL_SECONDS');
    const ttlSeconds = Number(raw ?? 3600);
    if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
      return 60 * 60 * 1000;
    }
    return ttlSeconds * 1000;
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
    const customer = data?.customer ?? data?.customer_privacy ?? data?.data;
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
