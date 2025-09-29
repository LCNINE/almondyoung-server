import {
  authenticate,
  defineMiddlewares,
  validateAndTransformQuery,
} from '@medusajs/framework/http';
import { createFindParams } from '@medusajs/medusa/api/utils/validators';
import { adminRouteMiddlewares } from './admin/middlewares';

export const GetRegionsSchema = createFindParams();

export default defineMiddlewares({
  routes: [
    {
      method: ['POST'],
      matcher: '/auth/token/restore',
      middlewares: [
        authenticate('all', ['session', 'bearer'], { allowUnregistered: true }),
      ],
    },
    {
      matcher: '/store/regions',
      method: 'GET',
      middlewares: [
        validateAndTransformQuery(GetRegionsSchema, {
          defaults: ['id', 'name', 'countries.*'],
          isList: true,
        }),
      ],
    },

    ...adminRouteMiddlewares,
  ],
});
