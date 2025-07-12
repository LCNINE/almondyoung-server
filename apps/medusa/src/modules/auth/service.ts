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
        entity_id: data.body!.loginId, // email or some ID
      });

      return {
        success: false,
        error: 'Identity with email already exists',
      };
    } catch (error) {
      if (error.type === MedusaError.Types.NOT_FOUND) {
        const createdAuthIdentity = await authIdentityProviderService.create({
          entity_id: data.body!.loginId, // email or some ID
          provider_metadata: {
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

  async authenticate(
    data: AuthenticationInput,
    authIdentityProviderService: AuthIdentityProviderService,
  ): Promise<AuthenticationResponse> {
    try {
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

      return {
        success: true,
        authIdentity: {
          id: user.id,
          provider_identities: [
            {
              id: user.id,
              provider: 'my-auth',
              entity_id: user.id,
              provider_metadata: {
                roles: user.roles || [],
                scopes: user.roles.map((role) => role.scopes),
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
