console.log("Loading src/api/admin/middlewares.ts");
import { authenticate, MiddlewareRoute } from '@medusajs/framework/http';
import { adminPaymentRoutesMiddlewares } from './payments/middlewares';
import { logHeadersMiddleware } from '../log-headers';

export const adminRouteMiddlewares: MiddlewareRoute[] = [
  {
    matcher: '/admin/*',
    middlewares: [logHeadersMiddleware],
  },
  {
    matcher: '/admin/*',
    method: ['POST'],
    middlewares: [authenticate('user', ['session', 'bearer', 'api-key'])],
  },
  {
    matcher: '/admin/*',
    method: ['GET'],
    middlewares: [
      logHeadersMiddleware,
      authenticate("user", ["api-key", "bearer", "session"]),
    ],
  },
  ...adminPaymentRoutesMiddlewares,
];


