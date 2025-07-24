import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from '@medusajs/framework/http';
import { Modules } from '@medusajs/framework/utils';
import {
  createCartWorkflow,
  CreateCartWorkflowInput,
} from '@medusajs/medusa/core-flows';
import { MedusaError } from '@medusajs/utils';

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

    // auth_context가 있을 때만 customer_id 설정
    if (req.auth_context?.actor_id) {
      cartData.customer_id = req.auth_context.actor_id;
    }
    console.log('req.auth_context', req.auth_context.actor_id);

    const { result } = await createCartWorkflow(req.scope).run({
      input: cartData,
    });

    return res.json(result);
  } catch (error) {
    if (error instanceof MedusaError) {
      switch (error.type) {
        case 'invalid_data':
          res.status(400).json({
            message: '잘못된 데이터가 전달되었습니다.',
            errors: error.message,
          });
          return;
        case 'not_allowed':
          res.status(403).json({
            message: '이 작업을 수행할 권한이 없습니다.',
            error: error.message,
          });
          return;
        case 'duplicate_error':
          res.status(409).json({
            message: '이미 존재하는 리소스입니다.',
            error: error.message,
          });
          return;
        case 'not_found':
          res.status(404).json({
            message: '리소스를 찾을 수 없습니다.',
            error: error.message,
          });
          return;
        default:
          res.status(400).json({
            message: '장바구니 생성 중 오류가 발생했습니다.',
            error: error.message,
          });
          return;
      }
    }
    console.log('error', error);

    res.status(500).json({
      message: '서버 오류가 발생했습니다.',
      error: error instanceof Error ? error.message : '알 수 없는 오류',
    });
  }
}
