import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { findOAuthClient, OAuthClientConfig } from '../../config/oauth-clients';

@Injectable()
export class OAuthReader {
  constructor(private readonly configService: ConfigService) {}

  getClientOrThrow(clientId: string): OAuthClientConfig {
    const client = findOAuthClient(clientId, this.configService.get<string>('OAUTH_CLIENTS'));
    if (!client) throw new NotFoundException(`unknown client: ${clientId}`);
    return client;
  }

  getInternalSecret(): string {
    const secret = this.configService.get<string>('OAUTH_INTERNAL_SECRET');
    if (!secret) throw new Error('OAUTH_INTERNAL_SECRET not configured');
    return secret;
  }
}
