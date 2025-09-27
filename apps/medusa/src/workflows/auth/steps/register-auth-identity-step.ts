import {
  AuthenticationInput,
  IAuthModuleService,
} from '@medusajs/framework/types';
import { Modules } from '@medusajs/framework/utils';
import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk';

type RegisterAuthIdentityInput = {
  authProvider: string;
  authData: AuthenticationInput;
};

export const registerAuthIdentityStep = createStep(
  'register-auth-identity',
  async (
    { authProvider, authData }: RegisterAuthIdentityInput,
    { container },
  ) => {
    const authService = container.resolve<IAuthModuleService>(Modules.AUTH);

    const { success, authIdentity, error } = await authService.register(
      authProvider,
      authData,
    );

    if (!success || !authIdentity) {
      throw new Error(error || 'Registration failed');
    }

    return new StepResponse(authIdentity, authIdentity.id);
  },
  // 롤백 함수 - Customer 생성 실패 시 AuthIdentity 삭제
  async (authIdentityId, { container }) => {
    if (!authIdentityId) {
      return;
    }

    try {
      const authService = container.resolve<IAuthModuleService>(Modules.AUTH);

      await authService.deleteAuthIdentities([authIdentityId]);
      console.log('AuthIdentity 롤백 완료:', authIdentityId);
    } catch (error) {
      console.error('AuthIdentity 롤백 실패:', error);
      throw error;
    }
  },
);
