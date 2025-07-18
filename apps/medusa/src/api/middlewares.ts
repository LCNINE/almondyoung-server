import { defineMiddlewares, authenticate } from '@medusajs/framework/http';
import cookieParser from 'cookie-parser';
import { responseWrapper } from '../middlewares/response-wrapper';
import { adminMiddlewares } from './admin/middlewares';
import { storeMiddlewares } from './store/middlewares';
import { COOKIE_NAME } from '../utils/set-auth-cookie';

export default defineMiddlewares({
  routes: [
    {
      matcher: '/*',
      middlewares: [cookieParser(), responseWrapper],
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
