import { Injectable } from '@nestjs/common';
import { IssueCodeRequestDto, IssueCodeResponseDto } from './dto/issue-code.dto';
import { TokenRequestDto, TokenResponseDto } from './dto/token.dto';
import { OAuthManager } from './oauth.manager';

@Injectable()
export class OAuthService {
  constructor(private readonly manager: OAuthManager) {}

  issueCode(input: IssueCodeRequestDto, internalSecret?: string): Promise<IssueCodeResponseDto> {
    this.manager.assertInternalSecret(internalSecret);
    return this.manager.issueAuthorizationCode(input);
  }

  exchangeToken(input: TokenRequestDto): Promise<TokenResponseDto> {
    return this.manager.issueToken(input);
  }

  revoke(clientId: string, clientSecret: string | undefined, token: string): Promise<void> {
    return this.manager.revokeRefreshToken(clientId, clientSecret, token);
  }

  userInfo(accessToken: string) {
    return this.manager.getUserInfo(accessToken);
  }

  endSession(input: {
    accessToken: string | null;
    clientId?: string;
    postLogoutRedirectUri?: string;
    state?: string;
  }) {
    return this.manager.endSession(input);
  }
}
