import { authenticate, MiddlewareRoute } from '@medusajs/framework/http';
import { adminPaymentRoutesMiddlewares } from './payments/middlewares';
import { logHeadersMiddleware } from '../log-headers';

// Medusa V2 validator rejects unknown fields — strip metadata before validation so our custom route can handle it
const extractPromotionMetadata = (req: any, _res: any, next: any) => {
  if (req.body?.metadata !== undefined) {
    req.promotionMetadata = req.body.metadata;
    delete req.body.metadata;
  }
  next();
};

export const adminRouteMiddlewares: MiddlewareRoute[] = [
  {
    matcher: '/admin/promotions',
    method: ['POST'],
    middlewares: [extractPromotionMetadata],
  },
  {
    matcher: '/admin/promotions/:id',
    method: ['POST'],
    middlewares: [extractPromotionMetadata],
  },
  // 로깅은 개발 환경에서만, 한 번만 적용
  {
    matcher: '/admin/*',
    middlewares: [logHeadersMiddleware],
  },
  {
    matcher: '/admin/*',
    method: ['GET'],
    middlewares: [authenticate('user', ['api-key', 'bearer', 'session'])],
  },
  {
    matcher: '/admin/*',
    method: ['POST', 'PUT', 'PATCH', 'DELETE'],
    middlewares: [authenticate('user', ['session', 'bearer', 'api-key'])],
  },
  ...adminPaymentRoutesMiddlewares,
];
