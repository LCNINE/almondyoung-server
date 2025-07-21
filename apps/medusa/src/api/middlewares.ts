import { authenticate, defineMiddlewares } from '@medusajs/framework/http';
import { adminMiddlewares } from './admin/middlewares';
import { storeMiddlewares } from './store/middlewares';

export default defineMiddlewares({
  routes: [
    {
      method: ['POST'],
      matcher: '/auth/token/restore',
      middlewares: [authenticate('*', 'bearer', { allowUnregistered: true })],
    },
    ...storeMiddlewares.routes,
    ...adminMiddlewares.routes,
  ],
});
