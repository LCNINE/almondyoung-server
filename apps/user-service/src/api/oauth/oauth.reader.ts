import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEMO_BYPASS_CLIENT_ID, findOAuthClient, OAuthClientConfig } from '../../config/oauth-clients';

@Injectable()
export class OAuthReader {
  constructor(private readonly configService: ConfigService) {}

  isBypassEnabled(): boolean {
    return this.configService.get<string>('OAUTH_BYPASS_VALIDATION') === 'true';
  }

  getClientOrThrow(clientId: string): OAuthClientConfig {
    if (this.isBypassEnabled()) {
      // TEMP: 시연용. 어떤 clientId가 와도 통과시키며, redirectUri 검증도 우회되도록 빈 배열을 둔다.
      return {
        clientId: clientId || DEMO_BYPASS_CLIENT_ID,
        clientSecretHash: '',
        redirectUris: [],
        allowedScopes: undefined,
      };
    }
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
