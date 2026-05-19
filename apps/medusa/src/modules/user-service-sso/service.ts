import crypto from 'crypto';
import {
  AuthIdentityProviderService,
  AuthenticationInput,
  AuthenticationResponse,
  Logger,
} from '@medusajs/framework/types';
import { AbstractAuthModuleProvider, MedusaError } from '@medusajs/framework/utils';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';

type Options = {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  authWebUrl: string;
  defaultCallbackUrl?: string;
  scopes?: string;
  userServiceUrl?: string;
};

type InjectedDependencies = {
  logger: Logger;
};

type StateValue = {
  callback_url: string;
  code_verifier: string;
  redirect_to?: string;
  created_at: number;
};

type TokenResponse = {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope?: string;
};

type IdTokenClaims = JWTPayload & {
  email?: string;
  email_verified?: boolean;
  name?: string;
  preferred_username?: string;
  login_id?: string;
};

const base64url = (buf: Buffer) =>
  buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

export class UserServiceSsoProviderService extends AbstractAuthModuleProvider {
  static identifier = 'user-service-sso';
  static DISPLAY_NAME = 'User Service SSO';

  static validateOptions(options: Record<string, unknown>) {
    const required = ['issuerUrl', 'clientId', 'clientSecret', 'authWebUrl'];
    for (const key of required) {
      if (!options?.[key]) {
        throw new Error(`user-service-sso: ${key} option is required`);
      }
    }
  }

  protected logger_: Logger;
  protected options_: Options;
  protected jwks_: ReturnType<typeof createRemoteJWKSet>;

  constructor({ logger }: InjectedDependencies, options: Options) {
    // @ts-ignore — Google/Github 공식 프로바이더와 동일한 super 호출 우회
    super(...arguments);
    this.logger_ = logger;
    this.options_ = options;
    this.jwks_ = createRemoteJWKSet(new URL('/.well-known/jwks.json', options.issuerUrl));
  }

  async register(): Promise<AuthenticationResponse> {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      'user-service-sso does not support direct registration. Sign-up is handled by user-service.',
    );
  }

  async update(): Promise<AuthenticationResponse> {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      'user-service-sso does not support direct update. Profile changes flow from user-service.',
    );
  }

  async authenticate(
    data: AuthenticationInput,
    authIdentityService: AuthIdentityProviderService,
  ): Promise<AuthenticationResponse> {
    const callbackUrl =
      (data.body?.callback_url as string | undefined) ??
      (data.query?.callback_url as string | undefined) ??
      this.options_.defaultCallbackUrl;

    if (!callbackUrl) {
      return { success: false, error: 'callback_url is required for redirect-based authentication' };
    }

    const redirectTo =
      (data.body?.redirect_to as string | undefined) ?? (data.query?.redirect_to as string | undefined);
    const prompt = (data.body?.prompt as string | undefined) ?? (data.query?.prompt as string | undefined);

    const stateKey = base64url(crypto.randomBytes(32));
    const codeVerifier = base64url(crypto.randomBytes(32));
    const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());

    const state: StateValue = {
      callback_url: callbackUrl,
      code_verifier: codeVerifier,
      redirect_to: redirectTo,
      created_at: Date.now(),
    };
    await authIdentityService.setState(stateKey, state);

    const authorizeUrl = new URL('/oauth/authorize', this.options_.authWebUrl);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', this.options_.clientId);
    authorizeUrl.searchParams.set('redirect_uri', callbackUrl);
    authorizeUrl.searchParams.set('scope', this.options_.scopes ?? 'openid email profile');
    authorizeUrl.searchParams.set('state', stateKey);
    authorizeUrl.searchParams.set('code_challenge', codeChallenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    if (prompt === 'login' || prompt === 'select_account') {
      authorizeUrl.searchParams.set('prompt', prompt);
    }

    return { success: true, location: authorizeUrl.toString() };
  }

  async validateCallback(
    data: AuthenticationInput,
    authIdentityService: AuthIdentityProviderService,
  ): Promise<AuthenticationResponse> {
    const query = data.query ?? {};
    const body = data.body ?? {};

    if (query.error) {
      return {
        success: false,
        error: `${query.error_description ?? query.error}`,
      };
    }

    const stateKey = (query.state as string | undefined) ?? (body.state as string | undefined);
    const code = (query.code as string | undefined) ?? (body.code as string | undefined);

    if (!stateKey) return { success: false, error: 'state is required' };
    if (!code) return { success: false, error: 'code is required' };

    const stateRaw = await authIdentityService.getState(stateKey);
    if (!stateRaw) return { success: false, error: 'No state found, or session expired' };

    const state = stateRaw as StateValue;
    if (!state.code_verifier || !state.callback_url) {
      return { success: false, error: 'state payload is malformed' };
    }

    let tokens: TokenResponse;
    try {
      tokens = await this.exchangeCode(code, state.code_verifier, state.callback_url);
    } catch (error: any) {
      return { success: false, error: error?.message ?? 'token exchange failed' };
    }

    let claims: IdTokenClaims;
    try {
      claims = await this.verifyIdToken(tokens.id_token);
    } catch (error: any) {
      return { success: false, error: error?.message ?? 'id_token verification failed' };
    }

    const entity_id = claims.sub;
    if (!entity_id) {
      return { success: false, error: 'id_token missing sub claim' };
    }

    let userMetadata: Record<string, unknown> = {
      email: claims.email,
      email_verified: claims.email_verified,
      name: claims.name,
      login_id: claims.preferred_username ?? claims.login_id,
      user_id: entity_id,
    };

    // id_token 클레임이 비어 있으면 userinfo로 보충
    if (!userMetadata.email || !userMetadata.name) {
      const userinfo = await this.fetchUserinfo(tokens.access_token).catch((e) => {
        this.logger_.warn(`user-service-sso: userinfo fetch failed — ${e?.message}`);
        return undefined;
      });
      if (userinfo) {
        userMetadata = {
          ...userMetadata,
          email: userMetadata.email ?? userinfo.email,
          name: userMetadata.name ?? userinfo.name ?? userinfo.nickname,
          login_id: userMetadata.login_id ?? userinfo.username,
        };
      }
    }

    // user-service 가 발급한 access/refresh 를 함께 보관해 callback route 가 storefront 에 surface 한다.
    // storefront 가 user-service API 를 호출할 때 사용 (단일 OIDC code-exchange 로 두 토큰을 모두 발급).
    // redirect_to: state에 보관된 값을 매 로그인마다 덮어쓴다 (null이면 이전 값 제거).
    const accessTokenExpiresAt = Date.now() + tokens.expires_in * 1000;
    const providerMetadata: Record<string, unknown> = {
      iss: claims.iss,
      sub: entity_id,
      access_token: tokens.access_token,
      access_token_expires_at: accessTokenExpiresAt,
      ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
      redirect_to: state.redirect_to ?? null,
    };

    let authIdentity;
    try {
      authIdentity = await authIdentityService.retrieve({ entity_id });
      authIdentity = await authIdentityService.update(entity_id, {
        user_metadata: { ...authIdentity.user_metadata, ...userMetadata },
        provider_metadata: { ...authIdentity.provider_metadata, ...providerMetadata },
      });
    } catch (error: any) {
      if (error?.type === MedusaError.Types.NOT_FOUND) {
        authIdentity = await authIdentityService.create({
          entity_id,
          user_metadata: userMetadata,
          provider_metadata: providerMetadata,
        });
      } else {
        return { success: false, error: error?.message ?? 'Failed to resolve auth identity' };
      }
    }

    return { success: true, authIdentity };
  }

  private async exchangeCode(
    code: string,
    codeVerifier: string,
    redirectUri: string,
  ): Promise<TokenResponse> {
    const tokenUrl = new URL('/oauth/token', this.options_.issuerUrl);
    const basic = Buffer.from(`${this.options_.clientId}:${this.options_.clientSecret}`).toString('base64');
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      client_id: this.options_.clientId,
    });

    const res = await fetch(tokenUrl.toString(), {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`token endpoint responded ${res.status}: ${text}`);
    }

    return (await res.json()) as TokenResponse;
  }

  private async verifyIdToken(idToken?: string): Promise<IdTokenClaims> {
    if (!idToken) {
      throw new Error('id_token is required (request scope=openid)');
    }

    const { payload } = await jwtVerify(idToken, this.jwks_, {
      issuer: this.options_.issuerUrl,
      audience: this.options_.clientId,
    });

    return payload as IdTokenClaims;
  }

  private async fetchUserinfo(
    accessToken: string,
  ): Promise<{ sub: string; email?: string; name?: string; nickname?: string; username?: string } | undefined> {
    const url = new URL('/oauth/userinfo', this.options_.userServiceUrl ?? this.options_.issuerUrl);
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`userinfo endpoint responded ${res.status}`);
    }
    return (await res.json()) as any;
  }
}
