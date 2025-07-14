import {
  defineMiddlewares,
  MedusaRequest,
  MedusaResponse,
  MedusaNextFunction,
  authenticate,
} from '@medusajs/framework/http';
import { responseWrapper } from '../middlewares/response-wrapper';

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
  ],
});
