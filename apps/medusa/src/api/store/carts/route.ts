import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from '@medusajs/framework/http';
import { Modules } from '@medusajs/framework/utils';
import {
  createCartWorkflow,
  CreateCartWorkflowInput,
} from '@medusajs/medusa/core-flows';
import { MedusaError } from '@medusajs/framework/utils';

/**
 * 장바구니 생성
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) {
  try {
    const cartService = req.scope.resolve(Modules.CART);

    const cartData = {
      ...((req.validatedBody || req.body) as Partial<CreateCartWorkflowInput>),
    };

    if (req.auth_context?.actor_id) {
      cartData.customer_id = req.auth_context.actor_id;
    }

    const { result } = await createCartWorkflow(req.scope).run({
      input: cartData,
    });

    return res.json(result);
  } catch (error) {
    if (error instanceof MedusaError || error?.type) {
      let statusCode = 500;
      const errorType = error.type;

      switch (errorType) {
        case MedusaError.Types.NOT_FOUND:
          statusCode = 404;
          break;
        case MedusaError.Types.NOT_ALLOWED:
          statusCode = 403;
          break;
        case MedusaError.Types.INVALID_DATA:
          statusCode = 400;
          break;
        case MedusaError.Types.UNAUTHORIZED:
          statusCode = 401;
          break;
        default:
          statusCode = 500;
      }

      return res.status(statusCode).json({
        message: error.message,
        type: errorType,
        code: error.code,
      });
    }

    return res.status(500).json({
      message: error?.message || '서버 오류가 발생했습니다.',
      type: 'internal_server_error',
    });
  }
}
