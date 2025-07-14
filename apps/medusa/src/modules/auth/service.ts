import {
  AuthIdentityProviderService,
  AuthenticationInput,
  AuthenticationResponse,
} from '@medusajs/framework/types';
import {
  AbstractAuthModuleProvider,
  MedusaError,
} from '@medusajs/framework/utils';
import UserModuleService from '../user/service';

export class AuthProviderService extends AbstractAuthModuleProvider {
  static identifier = 'my-auth';
  private userModule: UserModuleService;

  constructor() {
    super();
    this.userModule = new UserModuleService();
  }

  async register(
    data: AuthenticationInput,
    authIdentityProviderService: AuthIdentityProviderService,
  ): Promise<AuthenticationResponse> {
    try {
      await authIdentityProviderService.retrieve({
        entity_id: data.body!.user_id, // email or some ID
      });

      return {
        success: false,
        error: 'Identity with email already exists',
      };
    } catch (error) {
      if (error.type === MedusaError.Types.NOT_FOUND) {
        // provider_identity 테이블에 생성됌
        const createdAuthIdentity = await authIdentityProviderService.create({
          entity_id: data.body!.user_id, // email or some ID
          provider_metadata: {
            user_id: data.body!.user_id,
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
      // 토큰 인증 처리
      const authHeader = data?.headers?.authorization;

      if (!authHeader?.startsWith('Bearer ')) {
        return {
          success: false,
          error: 'No Bearer token found',
        };
      }

      const token = authHeader.split(' ')[1];
      const user = await this.userModule.fetchUser(token);

      if (!user) {
        return {
          success: false,
          error: 'Invalid credentials',
        };
      }

      // authIdentityProviderService를 사용하여 인증 정보 조회
      const authIdentity = await authIdentityProviderService.retrieve({
        entity_id: user.id,
      });

      return {
        success: true,
        authIdentity: {
          ...authIdentity,
          app_metadata: {
            user_id: user.id,
          },
          provider_identities: [
            {
              id: authIdentity.id,
              provider: 'my-auth',
              entity_id: user.id,
              provider_metadata: {
                roles: user.roles || [],
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
