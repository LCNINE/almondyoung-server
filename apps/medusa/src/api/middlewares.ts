import { authenticate, defineMiddlewares } from '@medusajs/framework/http';
import { responseWrapper } from '../middlewares/response-wrapper';
import { adminMiddlewares } from './admin/middlewares';
import { storeMiddlewares } from './store/middlewares';

export default defineMiddlewares({
  routes: [
    {
      matcher: '/*',
      middlewares: [responseWrapper],
    },
    {
      method: ['POST'],
      matcher: '/auth/token/restore',
      middlewares: [authenticate('*', 'bearer', { allowUnregistered: true })],
    },
    ...storeMiddlewares.routes,
    ...adminMiddlewares.routes,
  ],
});
