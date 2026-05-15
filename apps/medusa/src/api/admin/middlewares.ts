import { authenticate, MiddlewareRoute } from '@medusajs/framework/http';
import { adminPaymentRoutesMiddlewares } from './payments/middlewares';
import { logHeadersMiddleware } from '../log-headers';

export const adminRouteMiddlewares: MiddlewareRoute[] = [
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
