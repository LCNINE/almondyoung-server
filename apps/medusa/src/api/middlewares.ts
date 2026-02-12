console.log("Loading src/api/middlewares.ts");
import { authenticate, defineMiddlewares } from '@medusajs/framework/http';
import { adminRouteMiddlewares } from './admin/middlewares';

export default defineMiddlewares({
  routes: [
    ...adminRouteMiddlewares,
    {
      matcher: '/store/customers/me/promotions',
      middlewares: [authenticate('customer', ['session', 'bearer'])],
    },
    {
      matcher: '/store/customers/me/cart',
      middlewares: [authenticate('customer', ['session', 'bearer'])],
    },
  ],
});
