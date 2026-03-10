import { authenticate, defineMiddlewares } from '@medusajs/framework/http';
import { adminRouteMiddlewares } from './admin/middlewares';

// TODO: 401 디버깅용 미들웨어
// const debugAuthMiddleware = (req: any, _res: any, next: any) => {
//   const authHeader = req.headers?.authorization;
//   const cookie = req.headers?.cookie;
//   console.log(`[middleware-debug] ${req.method} ${req.path}`);
//   console.log(`[middleware-debug] hasAuthHeader: ${!!authHeader}, hasCookie: ${!!cookie}`);
//   if (authHeader) {
//     console.log(`[middleware-debug] authHeader: ${authHeader.substring(0, 50)}...`);
//   }
//   next();
// };

export default defineMiddlewares({
  routes: [
    ...adminRouteMiddlewares,
    // TODO: 401 디버깅용
    // {
    //   matcher: '/store/customers/me',
    //   middlewares: [debugAuthMiddleware],
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
