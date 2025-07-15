import { defineMiddlewares, authenticate } from '@medusajs/framework/http';

export const storeMiddlewares = {
  routes: [
    {
      matcher: '/store/cart',
      middlewares: [authenticate(['user', 'customer'], ['session', 'bearer'])],
    },
  ],
};
