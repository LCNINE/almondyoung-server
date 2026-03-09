import { authenticate, defineMiddlewares } from '@medusajs/framework/http';
import { adminRouteMiddlewares } from './admin/middlewares';

export default defineMiddlewares({
  routes: [
    ...adminRouteMiddlewares,
    // {
    //   matcher: '/store/customers/me',
    //   middlewares: [
    //     (req: any, _res: any, next: any) => {
    //       (req.allowed ??= []).push('groups');
    //       next();
    //     },
    //   ],
    // },
    {
      matcher: '/store/customers/me/promotions',
      middlewares: [authenticate('customer', ['session', 'bearer'])],
    },
    {
      matcher: '/store/customers/me/cart',
      middlewares: [authenticate('customer', ['session', 'bearer'])],
    },
    {
      matcher: '/store/orders/:id/confirm-purchase',
      middlewares: [authenticate('customer', ['session', 'bearer'])],
    },
  ],
});
