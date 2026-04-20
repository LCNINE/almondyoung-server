import crypto from 'crypto';
import {
  AuthIdentityProviderService,
  AuthenticationInput,
  AuthenticationResponse,
  Logger,
} from '@medusajs/framework/types';
import { AbstractAuthModuleProvider, MedusaError } from '@medusajs/framework/utils';
import { jwtVerify } from '../../utils/jwt-verify';
import { extractUserServiceToken } from '../../utils/extract-user-service-token';

type Options = {
  authWebUrl: string;
  authSecret: string;
  userServiceUrl?: string;
  defaultCallbackUrl?: string;
};

type InjectedDependencies = {
  logger: Logger;
};

type UserProfile = {
  id: string;
  email?: string;
  username?: string;
  loginId?: string;
};

export class UserServiceSsoProviderService extends AbstractAuthModuleProvider {
  static identifier = 'user-service-sso';
  static DISPLAY_NAME = 'User Service SSO';

  static validateOptions(options: Record<string, unknown>) {
    if (!options?.authWebUrl) {
      throw new Error('user-service-sso: authWebUrl option is required');
    }
    if (!options?.authSecret) {
      throw new Error('user-service-sso: authSecret option is required');
    }
  }

  protected logger_: Logger;
  protected options_: Options;

  constructor({ logger }: InjectedDependencies, options: Options) {
    // @ts-ignore - AbstractAuthModuleProvider에 명시적 ctor 시그니처가 없어 Google 구현도 동일한 우회 사용
    super(...arguments);
    this.logger_ = logger;
    this.options_ = options;
  }

  async register(): Promise<AuthenticationResponse> {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      'user-service-sso does not support direct registration. Sign-up is handled by auth-web/user-service.',
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
    const token = extractUserServiceToken(data.headers, data.query);

    if (token) {
      const silent = await this.silentAuth(token, authIdentityService);
      if (silent.success) return silent;
      // 쿠키/헤더 토큰이 유효하지 않으면 재로그인 redirect로 fallthrough
    }

    const callbackUrl =
      (data.body?.callback_url as string | undefined) ??
      (data.query?.callback_url as string | undefined) ??
      this.options_.defaultCallbackUrl;

    if (!callbackUrl) {
      return { success: false, error: 'callback_url is required for redirect-based authentication' };
    }

    const stateKey = crypto.randomBytes(32).toString('hex');
    await authIdentityService.setState(stateKey, {
      callback_url: callbackUrl,
      created_at: Date.now(),
    });

    const authUrl = new URL('/signin', this.options_.authWebUrl);
    const storefrontCallback = new URL(callbackUrl);
    storefrontCallback.searchParams.set('state', stateKey);
    authUrl.searchParams.set('redirect_to', storefrontCallback.toString());

    return { success: true, location: authUrl.toString() };
  }

  async validateCallback(
    data: AuthenticationInput,
    authIdentityService: AuthIdentityProviderService,
  ): Promise<AuthenticationResponse> {
    const stateKey = (data.query?.state as string | undefined) ?? (data.body?.state as string | undefined);
    if (!stateKey) {
      return { success: false, error: 'state is required' };
    }

    const state = await authIdentityService.getState(stateKey);
    if (!state) {
      return { success: false, error: 'No state found, or session expired' };
    }

    const token = extractUserServiceToken(data.headers, data.query);
    if (!token) {
      return { success: false, error: 'accessToken cookie or Bearer token is required' };
    }

    try {
      const payload = jwtVerify(token, this.options_.authSecret);
      const entity_id = payload.sub;
      if (!entity_id) {
        return { success: false, error: 'JWT is missing sub claim' };
      }

      const userMetadata: Record<string, unknown> = {
        email: payload.email,
        login_id: payload.login_id,
        roles: payload.roles,
      };

      if (this.options_.userServiceUrl) {
        const profile = await this.fetchProfile(token).catch((e) => {
          this.logger_.warn(`user-service-sso: profile fetch failed, falling back to JWT claims — ${e?.message}`);
          return undefined;
        });
        if (profile) {
          userMetadata.email = profile.email ?? userMetadata.email;
          userMetadata.username = profile.username;
        }
      }

      let authIdentity;
      try {
        authIdentity = await authIdentityService.retrieve({ entity_id });
        authIdentity = await authIdentityService.update(entity_id, {
          user_metadata: { ...authIdentity.user_metadata, ...userMetadata },
        });
      } catch (error: any) {
        if (error?.type === MedusaError.Types.NOT_FOUND) {
          authIdentity = await authIdentityService.create({
            entity_id,
            user_metadata: userMetadata,
          });
        } else {
          return { success: false, error: error?.message ?? 'Failed to resolve auth identity' };
        }
      }

      return { success: true, authIdentity };
    } catch (error: any) {
      return { success: false, error: error?.message ?? 'Callback validation failed' };
    }
  }

  private async silentAuth(
    token: string,
    authIdentityService: AuthIdentityProviderService,
  ): Promise<AuthenticationResponse> {
    try {
      const payload = jwtVerify(token, this.options_.authSecret);
      if (!payload.sub) {
        return { success: false };
      }
      const authIdentity = await authIdentityService.retrieve({ entity_id: payload.sub });
      return { success: true, authIdentity };
    } catch {
      return { success: false };
    }
  }

  private async fetchProfile(token: string): Promise<UserProfile | undefined> {
    const url = new URL('/users/me', this.options_.userServiceUrl);
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`user-service /users/me responded ${res.status}`);
    }
    return (await res.json()) as UserProfile;
  }
}
