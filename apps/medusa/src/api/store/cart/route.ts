import {
  AuthenticatedMedusaRequest,
  MedusaRequest,
  MedusaResponse,
} from '@medusajs/framework/http';
import { Modules } from '@medusajs/framework/utils';
import { MedusaError } from '@medusajs/utils';
import { CreateCartDTO, CreateLineItemDTO } from '@medusajs/types';
import { CUSTOM_USER_MODULE } from '../../../modules/custom-user';
import type UserModuleService from '../../../modules/custom-user/service';
import { User } from '../../../types/user.type';
import { createCartWorkflow } from '@medusajs/medusa/core-flows';

/**
 * 장바구니 생성
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) {
  try {
    const cartService = req.scope.resolve(Modules.CART);

    // 장바구니 생성 시 사용자 정보 추가
    const cartData: CreateCartDTO = {
      currency_code: 'KRW',
      ...(req.validatedBody as object),
    };

    const userId = req.auth_context.actor_id;

    if (userId) {
      const userCustomService =
        req.scope.resolve<UserModuleService>(CUSTOM_USER_MODULE);
      const user = await userCustomService.retrieveUser(userId);

      if (!user) {
        res.status(404).json({
          message: '사용자를 찾을 수 없습니다.',
        });
        return;
      }

      if (userId !== user.id) {
        res.status(403).json({
          message: '이 장바구니에 접근할 권한이 없습니다.',
        });
        return;
      }

      cartData.customer_id = user.id;
    }

    return res.json(cartData);
    // const { result } = await createCartWorkflow(req.scope).run({
    //   input: {
    //     ...cartData,
    //   },
    // });

    // res.json(result);
  } catch (error) {
    console.log('error:', error);
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

    res.status(500).json({
      message: '서버 오류가 발생했습니다.',
      error: error instanceof Error ? error.message : '알 수 없는 오류',
    });
  }
}

/**
 * 장바구니 조회
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const cartService = req.scope.resolve(Modules.CART);
    const { id } = req.params;

    if (!id) {
      res.status(400).json({
        message: '장바구니 ID가 필요합니다.',
      });
      return;
    }

    const cart = await cartService.retrieveCart(id, {
      relations: ['items', 'region', 'payment_sessions'],
    });

    if (!cart) {
      res.status(404).json({
        message: '장바구니를 찾을 수 없습니다.',
      });
      return;
    }

    // 로그인한 경우 소유자 확인
    const userId = (req.user as User)?.id;
    if (userId && cart.customer_id && cart.customer_id !== userId) {
      res.status(403).json({
        message: '이 장바구니에 접근할 권한이 없습니다.',
      });
      return;
    }

    res.json(cart);
  } catch (error) {
    if (error instanceof MedusaError) {
      switch (error.type) {
        case 'not_found':
          res.status(404).json({
            message: '장바구니를 찾을 수 없습니다.',
            error: error.message,
          });
          return;
        case 'invalid_data':
          res.status(400).json({
            message: '잘못된 데이터가 전달되었습니다.',
            error: error.message,
          });
          return;
        default:
          res.status(400).json({
            message: '장바구니 조회 중 오류가 발생했습니다.',
            error: error.message,
          });
          return;
      }
    }

    res.status(500).json({
      message: '서버 오류가 발생했습니다.',
      error: error instanceof Error ? error.message : '알 수 없는 오류',
    });
  }
}

/**
 * 장바구니 아이템 추가/수정
 */
export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  try {
    const cartService = req.scope.resolve(Modules.CART);
    const { id } = req.params;
    const validated = req.validatedBody as CreateLineItemDTO; // 메두사는 자동으로 req.body를 검증하고 req.validatedBody로 변환해줌

    // 필수 파라미터 확인
    if (
      !id ||
      !validated.variant_id ||
      typeof validated.quantity !== 'number'
    ) {
      res.status(400).json({
        message: '장바구니 ID, 상품 variant ID, 수량이 모두 필요합니다.',
      });
      return;
    }

    // 수량 검증
    if (validated.quantity < 0) {
      res.status(400).json({
        message: '수량은 0보다 커야 합니다.',
      });
      return;
    }

    // 장바구니 확인
    const existingCart = await cartService.retrieveCart(id);
    if (!existingCart) {
      res.status(404).json({
        message: '장바구니를 찾을 수 없습니다.',
      });
      return;
    }

    // 로그인한 경우 소유자 확인
    const userId = (req.user as User)?.id;
    if (
      userId &&
      existingCart.customer_id &&
      existingCart.customer_id !== userId
    ) {
      res.status(403).json({
        message: '이 장바구니에 접근할 권한이 없습니다.',
      });
      return;
    }

    const cart = await cartService.addLineItems(id, [validated]);
    res.json(cart);
  } catch (error) {
    if (error instanceof MedusaError) {
      switch (error.type) {
        case 'not_found':
          res.status(404).json({
            message: '장바구니 또는 상품을 찾을 수 없습니다.',
            error: error.message,
          });
          return;
        case 'invalid_data':
          res.status(400).json({
            message: '잘못된 데이터가 전달되었습니다.',
            error: error.message,
          });
          return;
        case 'not_allowed':
          res.status(403).json({
            message: '이 작업을 수행할 권한이 없습니다.',
            error: error.message,
          });
          return;
        case 'insufficient_inventory':
          res.status(409).json({
            message: '재고가 부족합니다.',
            error: error.message,
          });
          return;
        default:
          res.status(400).json({
            message: '장바구니 아이템 수정 중 오류가 발생했습니다.',
            error: error.message,
          });
          return;
      }
    }

    res.status(500).json({
      message: '서버 오류가 발생했습니다.',
      error: error instanceof Error ? error.message : '알 수 없는 오류',
    });
  }
}

/**
 * 장바구니 아이템 삭제
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    const cartService = req.scope.resolve(Modules.CART);
    const { id, item_id } = req.params;

    if (!id || !item_id) {
      res.status(400).json({
        message: '장바구니 ID와 아이템 ID가 모두 필요합니다.',
      });
      return;
    }

    // 장바구니 확인
    const existingCart = await cartService.retrieveCart(id);
    if (!existingCart) {
      res.status(404).json({
        message: '장바구니를 찾을 수 없습니다.',
      });
      return;
    }

    // 로그인한 경우 소유자 확인
    const userId = (req.user as User)?.id;
    if (
      userId &&
      existingCart.customer_id &&
      existingCart.customer_id !== userId
    ) {
      res.status(403).json({
        message: '이 장바구니에 접근할 권한이 없습니다.',
      });
      return;
    }

    await cartService.deleteLineItems([item_id]);
    const cart = await cartService.retrieveCart(id);

    res.json(cart);
  } catch (error) {
    if (error instanceof MedusaError) {
      switch (error.type) {
        case 'not_found':
          res.status(404).json({
            message: '장바구니 또는 아이템을 찾을 수 없습니다.',
            error: error.message,
          });
          return;
        case 'invalid_data':
          res.status(400).json({
            message: '잘못된 데이터가 전달되었습니다.',
            error: error.message,
          });
          return;
        case 'not_allowed':
          res.status(403).json({
            message: '이 작업을 수행할 권한이 없습니다.',
            error: error.message,
          });
          return;
        default:
          res.status(400).json({
            message: '장바구니 아이템 삭제 중 오류가 발생했습니다.',
            error: error.message,
          });
          return;
      }
    }

    res.status(500).json({
      message: '서버 오류가 발생했습니다.',
      error: error instanceof Error ? error.message : '알 수 없는 오류',
    });
  }
}
