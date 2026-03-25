import { DbService, InjectDb } from '@app/db';
import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { eq } from 'drizzle-orm';
import { firstValueFrom } from 'rxjs';
import { cafe24Tokens, type Cafe24Token, type UserServiceSchema } from '../../../database/drizzle/schema';
import { DbTransaction } from '../../commons/types';

@Injectable()
export class Cafe24TokensService {
  private readonly logger = new Logger(Cafe24TokensService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  private getClient(tx?: DbTransaction) {
    return tx ?? this.dbService.db;
  }

  async getAllTokens(tx?: DbTransaction): Promise<Cafe24Token[]> {
    const client = this.getClient(tx);
    return await client.select().from(cafe24Tokens);
  }

  @Interval(55 * 60 * 1000)
  async refreshCafe24Tokens() {
    const tokens = await this.getAllTokens();

    if (tokens.length === 0) {
      this.logger.warn('Cafe24 token refresh skipped: no tokens in db');
      return;
    }

    for (const token of tokens) {
      await this.refreshToken(token);
    }
  }

  private async refreshToken(token: Cafe24Token) {
    const clientId = this.configService.get<string>('CAFE24_CLIENT_ID');
    const clientSecret = this.configService.get<string>('CAFE24_CLIENT_SECRET');
    const tokenUrl = this.buildTokenUrl(token.mallId);

    if (!clientId || !clientSecret) {
      this.logger.warn('Cafe24 token refresh skipped: missing CAFE24_CLIENT_ID/CAFE24_CLIENT_SECRET');
      return;
    }

    try {
      const params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: token.refreshToken,
      });
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');

      const response = await firstValueFrom(
        this.httpService.post(tokenUrl, params.toString(), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${basicAuth}`,
          },
        }),
      );

      const data = response.data ?? {};
      const accessToken = data.access_token;
      const refreshToken = data.refresh_token ?? token.refreshToken;
      const expiresAt = this.parseExpiresAt(data.expires_at, data.expires_in, token.expiresAt);
      const refreshTokenExpiresAt = this.parseDateValue(data.refresh_token_expires_at);
      const now = new Date();

      if (!accessToken) {
        throw new Error('Cafe24 refresh response missing access_token');
      }

      await this.getClient()
        .update(cafe24Tokens)
        .set({
          accessToken,
          refreshToken,
          expiresAt,
          refreshTokenExpiresAt,
          lastRefreshedAt: now,
          lastError: null,
          updatedAt: now,
        })
        .where(eq(cafe24Tokens.id, token.id));

      this.logger.log(`Cafe24 token refreshed (mallId=${token.mallId})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const now = new Date();

      await this.getClient()
        .update(cafe24Tokens)
        .set({
          lastError: message,
          updatedAt: now,
        })
        .where(eq(cafe24Tokens.id, token.id));

      this.logger.error(`Cafe24 token refresh failed (mallId=${token.mallId}): ${message}`);
    }
  }

  private buildTokenUrl(mallId: string) {
    const overrideUrl = this.configService.get<string>('CAFE24_TOKEN_URL');
    if (overrideUrl) {
      return overrideUrl;
    }

    return `https://${mallId}.cafe24api.com/api/v2/oauth/token`;
  }

  private parseExpiresAt(expiresAtValue: unknown, expiresInValue: unknown, fallback: Date) {
    const parsed = this.parseDateValue(expiresAtValue);
    if (parsed) {
      return parsed;
    }

    const expiresInSeconds = Number(expiresInValue);
    if (Number.isFinite(expiresInSeconds)) {
      return new Date(Date.now() + expiresInSeconds * 1000);
    }

    return fallback;
  }

  private parseDateValue(value: unknown) {
    if (!value) {
      return null;
    }

    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return parsed;
  }
}
