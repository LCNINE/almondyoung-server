import { authenticate, MiddlewareRoute } from '@medusajs/framework/http';
import { adminPaymentRoutesMiddlewares } from './payments/middlewares';

export const adminRouteMiddlewares: MiddlewareRoute[] = [
  {
    matcher: '/admin/*',
    method: ['POST'],
    middlewares: [authenticate('user', ['session', 'bearer'])],
  },
  {
    matcher: '/admin/*',
    method: ['GET'],
    middlewares: [authenticate('user', ['session', 'bearer'])],
  },
  ...adminPaymentRoutesMiddlewares,
];
