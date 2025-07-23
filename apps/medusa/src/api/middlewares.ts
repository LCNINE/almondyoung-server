import { authenticate, defineMiddlewares } from '@medusajs/framework/http';
import { adminRouteMiddlewares } from './admin/middlewares';
import { storeRouteMiddlewares } from './store/middleware';

export default defineMiddlewares({
  routes: [
    {
      method: ['POST'],
      matcher: '/auth/token/restore',
      middlewares: [authenticate('*', 'bearer', { allowUnregistered: true })],
    },
    ...adminRouteMiddlewares,
    ...storeRouteMiddlewares,
  ],
});
