import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicKey, type JsonWebKey } from 'node:crypto';

export interface JwksResponse {
  keys: Array<JsonWebKey & { kid: string; alg: string; use: 'sig' }>;
}

export interface OidcDiscoveryResponse {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  end_session_endpoint: string;
  revocation_endpoint: string;
  scopes_supported: string[];
  response_types_supported: string[];
  grant_types_supported: string[];
  code_challenge_methods_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  subject_types_supported: string[];
  id_token_signing_alg_values_supported: string[];
}

@Injectable()
export class WellKnownService {
  private readonly jwks: JwksResponse;
  private readonly discovery: OidcDiscoveryResponse;

  constructor(config: ConfigService) {
    const publicKeyPem = config.getOrThrow<string>('OAUTH_JWT_PUBLIC_KEY');
    const kid = config.getOrThrow<string>('OAUTH_JWT_KID');
    const issuer = config.getOrThrow<string>('OAUTH_ISSUER_URL').replace(/\/$/, '');
    const authWebOrigin = config.getOrThrow<string>('AUTH_WEB_ORIGIN').replace(/\/$/, '');

    const jwk = createPublicKey({ key: publicKeyPem, format: 'pem' }).export({ format: 'jwk' });
    this.jwks = { keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }] };

    // 주의: authorization_endpoint 는 의도적으로 auth-web origin 으로 분리된다.
    // 사용자 상호작용(계정 허브, 로그인 폼)이 auth-web 에서 일어나기 때문이다.
    // issuer 와 호스트가 다르지만 표준 RP 들은 metadata 가 알려준 endpoint 를 그대로 사용한다.
    this.discovery = {
      issuer,
      authorization_endpoint: `${authWebOrigin}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      userinfo_endpoint: `${issuer}/oauth/userinfo`,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
      end_session_endpoint: `${issuer}/oauth/end_session`,
      revocation_endpoint: `${issuer}/oauth/revoke`,
      scopes_supported: ['profile', 'email'],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
      subject_types_supported: ['public'],
      // OIDC Discovery REQUIRED 필드. 현재 access token 만 RS256 으로 발급한다.
      // id_token 자체 발급은 후속 작업이지만 metadata 는 RS256 으로 명시.
      id_token_signing_alg_values_supported: ['RS256'],
    };
  }

  getJwks(): JwksResponse {
    return this.jwks;
  }

  getDiscovery(): OidcDiscoveryResponse {
    return this.discovery;
  }
}
