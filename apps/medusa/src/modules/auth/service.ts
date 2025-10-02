import { USER_SCOPES } from '@libs/roles/src';
import { jwtVerify } from '@medusa/utils/jwt-verify';
import {
  AuthIdentityProviderService,
  AuthenticationInput,
  AuthenticationResponse,
} from '@medusajs/framework/types';
import {
  AbstractAuthModuleProvider,
  MedusaError,
} from '@medusajs/framework/utils';
import CustomUserModuleService from '@modules/custom-user/service';

export class AuthProviderService extends AbstractAuthModuleProvider {
  static identifier = 'my-auth';
  private userCustomModule: CustomUserModuleService;

  constructor() {
    super();
    this.userCustomModule = new CustomUserModuleService();
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
        return {
          success: false,
          error: 'No token found',
        };
      }

      if (process.env.NODE_ENV !== 'production' && !process.env.JWT_SECRET) {
        return {
          success: false,
          error: 'JWT_SECRET is not defined',
        };
      }

      const payload = jwtVerify(almond_token, process.env.AUTH_SECRET!);

      // authIdentityProviderService를 사용하여 인증 정보 조회
      const authIdentity = await authIdentityProviderService.retrieve({
        entity_id: payload.email,
      });
      // 메두사에서 'user'는 관리자 권한이 있는 사용자를 의미함
      const actorType = payload.scopes?.some(
        (role) =>
          role === USER_SCOPES.MASTER.key ||
          role === USER_SCOPES.ADMIN.ACCESS.key,
      )
        ? 'user'
        : 'customer';

      return {
        success: true,
        authIdentity: {
          ...authIdentity,
          app_metadata: {
            actor_type: actorType,
            user_id: authIdentity?.app_metadata?.user_id,
            customer_id: authIdentity?.app_metadata?.customer_id,
            email: payload.email,
            scopes: [payload.scopes],
          },
          provider_identities: [
            {
              id: authIdentity.id,
              provider: 'my-auth',
              entity_id: payload.email,
              provider_metadata: {
                scopes: [payload.scopes],
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
