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
  scopes_supported: string[];
  response_types_supported: string[];
  grant_types_supported: string[];
  code_challenge_methods_supported: string[];
  id_token_signing_alg_values_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  subject_types_supported: string[];
}

@Injectable()
export class WellKnownService {
  private readonly jwks: JwksResponse;
  private readonly discovery: OidcDiscoveryResponse;

  constructor(config: ConfigService) {
    const publicKeyPem = config.getOrThrow<string>('OAUTH_JWT_PUBLIC_KEY');
    const kid = config.getOrThrow<string>('OAUTH_JWT_KID');
    const issuer = config.getOrThrow<string>('OAUTH_ISSUER_URL').replace(/\/$/, '');

    const jwk = createPublicKey({ key: publicKeyPem, format: 'pem' }).export({ format: 'jwk' });
    this.jwks = { keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }] };

    this.discovery = {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      userinfo_endpoint: `${issuer}/oauth/userinfo`,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
      scopes_supported: ['openid', 'profile', 'email'],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      id_token_signing_alg_values_supported: ['RS256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      subject_types_supported: ['public'],
    };
  }

  getJwks(): JwksResponse {
    return this.jwks;
  }

  getDiscovery(): OidcDiscoveryResponse {
    return this.discovery;
  }
}
