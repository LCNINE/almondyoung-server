import {
  AuthIdentityProviderService,
  AuthenticationInput,
  AuthenticationResponse,
} from '@medusajs/framework/types';
import {
  AbstractAuthModuleProvider,
  MedusaError,
} from '@medusajs/framework/utils';
import { jwtVerify } from '../../utils/jwt-verify';

export class AuthProviderService extends AbstractAuthModuleProvider {
  static identifier = 'my-auth';

  constructor(container: Record<string, unknown>) {
    super();
  }

  async register(
    data: AuthenticationInput,
    authIdentityProviderService: AuthIdentityProviderService,
  ): Promise<AuthenticationResponse> {
    try {
      await authIdentityProviderService.retrieve({
        entity_id: data.body!.email, // email or some ID
      });

      return {
        success: false,
        error: 'Identity with email already exists',
      };
    } catch (error) {
      if (error.type === MedusaError.Types.NOT_FOUND) {
        // provider_identity 테이블에 생성됌
        const createdAuthIdentity = await authIdentityProviderService.create({
          entity_id: data.body!.email, // email or some ID
          provider_metadata: {
            almond_user_id: data.body!.almond_user_id,
            almond_login_id: data.body!.almond_login_id,
            password: data.body!.password,
            // can include password or any other relevant information
          },
        });

        return {
          success: true,
          authIdentity: createdAuthIdentity,
        };
      }

      return { success: false, error: error.message };
    }
  }

  // 인증 및 로그인에 사용됌
  async authenticate(
    data: AuthenticationInput,
    authIdentityProviderService: AuthIdentityProviderService,
  ): Promise<AuthenticationResponse> {
    try {
      const authHeader = data?.headers?.authorization;
      let almond_token;

      if (authHeader?.startsWith('Bearer ')) {
        almond_token = authHeader.split(' ')[1];
      } else {
        // 쿠키에서 토큰 조회
        const cookies = data?.headers?.cookie;
        if (cookies) {
          const tokenCookie = cookies
            .split(';')
            .find((cookie) => cookie.trim().startsWith('accessToken='));
          if (tokenCookie) {
            almond_token = tokenCookie.split('=')[1];
          }
        }
      }

      if (!almond_token) {
        // 토큰이 없으면 이 프로바이더에서는 인증 실패로 처리하되,
        // 에러를 반환하지 않고 다음 프로바이더(예: api-key)가 처리할 수 있게 함
        return {
          success: false,
        };
      }

      if (!process.env.JWT_SECRET) {
        return {
          success: false,
          error: 'JWT_SECRET is not defined',
        };
      }

      if (!process.env.AUTH_SECRET) {
        return {
          success: false,
          error: 'AUTH_SECRET is not defined',
        };
      }

      const payload = jwtVerify(almond_token, process.env.AUTH_SECRET!);

      // authIdentityProviderService를 사용하여 인증 정보 조회
      const authIdentity = await authIdentityProviderService.retrieve({
        entity_id: payload.email,
      });
      // 메두사에서 'user'는 관리자 권한이 있는 사용자를 의미함
      const isAdmin = payload.roles?.some(
        (role) => role === 'master' || role === 'admin',
      );
      const actorType = isAdmin ? 'user' : 'customer';

      return {
        success: true,
        authIdentity: {
          ...authIdentity,
          app_metadata: {
            actor_type: actorType,
            user_id: authIdentity?.app_metadata?.user_id || payload.sub,
            customer_id: authIdentity?.app_metadata?.customer_id,
            email: payload.email,
            roles: payload.roles,
          },
          provider_identities: [
            {
              id: authIdentity.id,
              provider: 'my-auth',
              entity_id: payload.email,
              provider_metadata: {
                roles: payload.roles,
              },
            },
          ],
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Authentication failed',
      };
    }
  }
}
