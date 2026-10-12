import { validateAndTransformBody } from '@medusajs/framework';
import type { MiddlewareRoute } from '@medusajs/framework/http';
import { AdminTimeSaleWrite } from './validators';

// 옵션이 수천 개인 세일은 일반·멤버십 세일가 본문이 기본 한도(100kb)를 넘는다(230개 상품 세일에서 413).
const bodyParser = { sizeLimit: '5mb' };

export const adminTimeSaleRoutesMiddlewares: MiddlewareRoute[] = [
  {
    method: ['POST'],
    matcher: '/admin/time-sales',
    bodyParser,
    middlewares: [validateAndTransformBody(AdminTimeSaleWrite)],
  },
  {
    method: ['POST'],
    matcher: '/admin/time-sales/:id',
    bodyParser,
    middlewares: [validateAndTransformBody(AdminTimeSaleWrite)],
  },
];
