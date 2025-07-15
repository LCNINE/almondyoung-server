import { defineMiddlewares, authenticate } from '@medusajs/framework/http';

export const adminMiddlewares = {
  routes: [
    {
      matcher: '/admin/*',
      method: 'POST',
      middlewares: [authenticate('user', ['session', 'bearer'])],
    },
    {
      matcher: '/admin/*',
      method: 'GET',
      middlewares: [authenticate('user', ['session', 'bearer'])],
    },
  ],
};
