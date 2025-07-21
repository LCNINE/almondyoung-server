import {
  AuthIdentityProviderService,
  AuthenticationInput,
  AuthenticationResponse,
} from '@medusajs/framework/types';
import {
  AbstractAuthModuleProvider,
  MedusaError,
} from '@medusajs/framework/utils';
import CustomUserModuleService from '../custom-user/service';
import { USER_ROLES } from '@/roles/src/constants/roles.constant';

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

        // ToDO roles medusa-admin 권한 있으면 USEr 테이블 생성

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
      const user = await this.userCustomModule.getUserDetailsByToken(token);

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

      const userRoles = await this.userCustomModule.getUserRoles(
        user.id,
        token,
      );

      // 메두사에서 'user'는 관리자 권한이 있는 사용자를 의미함
      const actorType = userRoles.roles?.some(
        (role) => role.role.name === USER_ROLES.MASTER,
      )
        ? 'user'
        : 'customer';

      return {
        success: true,
        authIdentity: {
          ...authIdentity,
          app_metadata: {
            actor_type: actorType,
            user_id: user.id,
            email: user.email,
            role: userRoles.roles[0].role.name,
          },
          provider_identities: [
            {
              id: authIdentity.id,
              provider: 'my-auth',
              entity_id: user.id,
              provider_metadata: {
                roles: userRoles.roles[0].role.name || [],
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
