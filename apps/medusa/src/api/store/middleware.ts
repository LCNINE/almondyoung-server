import {
  defineMiddlewares,
  authenticate,
  validateAndTransformBody,
  MiddlewareRoute,
} from '@medusajs/framework/http';
import { CreateCartSchema } from './validators';

export const storeRouteMiddlewares: MiddlewareRoute[] = [
  {
    method: ['POST'],
    matcher: '/store/carts',
    middlewares: [
      authenticate(['user', 'customer'], ['session', 'bearer'], {
        allowUnauthenticated: true,
      }),
      validateAndTransformBody(CreateCartSchema),
    ],
  },
];
