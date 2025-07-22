import {
  defineMiddlewares,
  authenticate,
  validateAndTransformBody,
} from '@medusajs/framework/http';
import { CreateCartSchema } from './validators';

export const storeMiddlewares = {
  routes: [
    {
      matcher: '/store/cart',
      middlewares: [
        authenticate(['user', 'customer'], ['session', 'bearer']),
        validateAndTransformBody(CreateCartSchema),
      ],
    },
  ],
};
