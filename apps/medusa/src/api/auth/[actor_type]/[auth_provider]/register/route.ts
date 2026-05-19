import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { AuthenticationInput } from '@medusajs/framework/types';
import { MedusaError } from '@medusajs/framework/utils';
import { registerCustomerWorkflow } from '../../../../../workflows/auth/workflows/register-customer-workflow';
import { registerUserWorkflow } from '../../../../../workflows/auth/workflows/register-user-workflow';

type RegisterCustomerInput = {
  almond_user_id: string;
  almond_login_id: string;
  email: string;
  first_name?: string;
  last_name?: string;
};

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const { actor_type, auth_provider } = req.params;

    console.log('메두사 회원가입 요청!!!!!');

    // actor_type이 customer인 경우
    if (actor_type === 'customer') {
      const body = req.body as RegisterCustomerInput;

      console.log('메두사 회원가입 요청 body:!!!!', body);

      const { result } = await registerCustomerWorkflow(req.scope).run({
        input: {
          authProvider: auth_provider,
          authData: {
            url: req.url,
            headers: req.headers as Record<string, string>,
            query: req.query as Record<string, string>,
            body: req.body as Record<string, string>,
            protocol: req.protocol,
          } as AuthenticationInput,

          customerData: {
            email: body.email,
            first_name: body.first_name || '',
            last_name: body.last_name || '',
            metadata: {
              almond_user_id: body.almond_user_id,
              almond_login_id: body.almond_login_id,
            },
          },
        },
      });

      return res.status(201).json({
        authIdentity: {
          id: result.authIdentity.id,
        },
        customer: {
          id: result.customer.id,
        },
      });
    } else {
      // user(admin)의 경우
      const body = req.body as any;

      const { result } = await registerUserWorkflow(req.scope).run({
        input: {
          authProvider: auth_provider,
          authData: {
            url: req.url,
            headers: req.headers as Record<string, string>,
            query: req.query as Record<string, string>,
            body: req.body as Record<string, string>,
            protocol: req.protocol,
          } as AuthenticationInput,
          userData: {
            email: body.email || body.user_id,
            first_name: body.first_name || '',
            last_name: body.last_name || '',
          },
        },
      });

      return res.status(201).json({
        authIdentity: {
          id: result.authIdentity.id,
        },
        user: {
          id: result.user.id,
        },
      });
    }
  } catch (error) {
    console.error('Registration 에러:', error);

    // 이미 존재하는 이메일인 경우 409 Conflict로 처리
    if (error.message?.includes('already exists')) {
      return res.status(409).json({
        error: error.message,
        type: 'CONFLICT',
      });
    }

    if (error instanceof MedusaError) {
      return res.status(error.type === MedusaError.Types.INVALID_DATA ? 400 : 500).json({
        error: error.message,
        type: error.type,
      });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
};
