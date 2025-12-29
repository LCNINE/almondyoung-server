console.log("Loading src/api/middlewares.ts");
import {
  authenticate,
  defineMiddlewares,
  validateAndTransformQuery,
} from '@medusajs/framework/http';
import { createFindParams } from '@medusajs/medusa/api/utils/validators';
import { adminRouteMiddlewares } from './admin/middlewares';
import { logHeadersMiddleware } from './log-headers';

export const GetRegionsSchema = createFindParams();

export default defineMiddlewares({
  routes: [
    ...adminRouteMiddlewares,
  ],
});
