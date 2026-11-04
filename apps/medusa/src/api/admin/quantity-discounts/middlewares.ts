import { validateAndTransformBody } from '@medusajs/framework';
import type { MiddlewareRoute } from '@medusajs/framework/http';
import { AdminQuantityDiscountSync } from './products/[id]/validators';

export const adminQuantityDiscountRoutesMiddlewares: MiddlewareRoute[] = [
  {
    method: ['POST'],
    matcher: '/admin/quantity-discounts/products/:id',
    // 옵션이 수백 개인 상품은 구간가 본문이 기본 한도(100kb)에 닿는다.
    bodyParser: { sizeLimit: '2mb' },
    middlewares: [validateAndTransformBody(AdminQuantityDiscountSync)],
  },
];
