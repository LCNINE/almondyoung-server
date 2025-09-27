import {
  createWorkflow,
  WorkflowResponse,
} from '@medusajs/framework/workflows-sdk';
import { createUserAccountWorkflow } from '@medusajs/medusa/core-flows';
import { registerAuthIdentityStep } from '../steps/register-auth-identity-step';
import { AuthenticationInput } from '@medusajs/framework/types';

type RegisterUserWorkflowInput = {
  authProvider: string;
  authData: AuthenticationInput;
  userData: {
    email: string;
    first_name?: string;
    last_name?: string;
  };
};

export const registerUserWorkflow = createWorkflow(
  'register-user-with-auth',
  (input: RegisterUserWorkflowInput) => {
    // Step 1: AuthIdentity 생성
    const authIdentity = registerAuthIdentityStep({
      authProvider: input.authProvider,
      authData: input.authData,
    });

    // Step 2: User 생성 (실패하면 Step 1도 롤백됨!)
    const user = createUserAccountWorkflow.runAsStep({
      input: {
        authIdentityId: authIdentity.id,
        userData: input.userData,
      },
    });

    return new WorkflowResponse({
      authIdentity,
      user,
    });
  },
);
