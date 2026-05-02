import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuthClientRow, OAuthRepository } from './oauth.repository';

@Injectable()
export class OAuthReader {
  constructor(
    private readonly repo: OAuthRepository,
    private readonly configService: ConfigService,
  ) {}

  async getClientOrThrow(clientId: string): Promise<OAuthClientRow> {
    const client = await this.repo.findActiveClientById(clientId);
    if (!client) throw new NotFoundException(`unknown client: ${clientId}`);
    return client;
  }

  getInternalSecret(): string {
    const secret = this.configService.get<string>('OAUTH_INTERNAL_SECRET');
    if (!secret) throw new Error('OAUTH_INTERNAL_SECRET not configured');
    return secret;
  }
}
