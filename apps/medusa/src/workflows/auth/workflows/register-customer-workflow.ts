import { AuthenticationInput } from '@medusajs/framework/types';
import {
  createWorkflow,
  WorkflowResponse,
} from '@medusajs/framework/workflows-sdk';
import { createCustomerAccountWorkflow } from '@medusajs/medusa/core-flows';
import { registerAuthIdentityStep } from '../steps/register-auth-identity-step';

type RegisterCustomerWorkflowInput = {
  authProvider: string;
  authData: AuthenticationInput;
  customerData: {
    email: string;
    first_name?: string;
    last_name?: string;
    metadata: Record<string, string>;
  };
};

export const registerCustomerWorkflow = createWorkflow(
  'register-customer-with-auth',
  (input: RegisterCustomerWorkflowInput) => {
    // Step 1: AuthIdentity 생성
    const authIdentity = registerAuthIdentityStep({
      authProvider: input.authProvider,
      authData: input.authData,
    });

    // Step 2: Customer 생성 (실패하면 Step 1도 롤백됨!)
    const customer = createCustomerAccountWorkflow.runAsStep({
      input: {
        authIdentityId: authIdentity.id,
        customerData: input.customerData,
      },
    });

    return new WorkflowResponse({
      authIdentity,
      customer,
    });
  },
);
