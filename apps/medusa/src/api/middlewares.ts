import { authenticate, defineMiddlewares } from '@medusajs/framework/http';
import { responseWrapper } from '../middlewares/response-wrapper';
import { COOKIE_NAME } from '../utils/set-auth-cookie';
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
    {
      matcher: '/auth/session',
      middlewares: [
        (req, res, next) => {
          req.headers.authorization = `Bearer ${req.cookies[COOKIE_NAME]}`;

          next();
        },
        authenticate(['user'], ['bearer', 'session'], {
          allowUnregistered: true,
        }),
      ],
    },
    ...storeMiddlewares.routes,
    ...adminMiddlewares.routes,
  ],
});
