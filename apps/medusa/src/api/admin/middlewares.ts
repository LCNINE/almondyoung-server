import {
  defineMiddlewares,
  authenticate,
  type MiddlewareVerb,
  MiddlewareRoute,
} from '@medusajs/framework/http';

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
];
