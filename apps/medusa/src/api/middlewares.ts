import { authenticate, defineMiddlewares } from '@medusajs/framework/http';
import { adminRouteMiddlewares } from './admin/middlewares';

export default defineMiddlewares({
  routes: [
    {
      method: ['POST'],
      matcher: '/auth/token/restore',
      middlewares: [authenticate('*', 'bearer', { allowUnregistered: true })],
    },
    ...adminRouteMiddlewares,
  ],
});
